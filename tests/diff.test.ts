import { describe, expect, it } from 'vitest';
import { diffInventories, formatDiffMarkdown, scanSource, type Inventory } from '../src/index.ts';

const code = `import { test, expect } from 'vitest';
test('quotes the bid', () => expect(187.25).toBeGreaterThan(0));
test('quotes the ask', () => expect(187.75).toBeGreaterThan(0));`;

function inventory(source = code, file = 'tests/quotes.test.ts'): Inventory {
  return scanSource({ code: source, relativeFilePath: file, framework: 'vitest', frameworkVersion: '5.1.0' });
}

describe('diffInventories', () => {
  it('ignores line moves in annotations and Playwright steps', () => {
    const source = `import { test } from '@playwright/test';
test('routes a limit order', { annotation: { type: 'issue', description: 'EXAMPLE-123' } }, async () => {
  await test.step('reads the order book', async () => {});
  test.info().annotations.push({ type: 'venue', description: 'paper' });
});`;
    const before = scanSource({ code: source, relativeFilePath: 'tests/orders.spec.ts', framework: 'playwright' });
    const after = scanSource({
      code: `\n\n${source}`,
      relativeFilePath: 'tests/orders.spec.ts',
      framework: 'playwright',
    });
    expect(before.tests[0].annotations).toHaveLength(2);
    expect(before.tests[0].steps).toHaveLength(1);
    const saved = JSON.stringify([before, after]);
    const result = diffInventories(before, after);
    expect(result.changes).toEqual([]);
    expect(result.summary).toMatchObject({ unchanged: 1, changed: 0 });
    expect(JSON.stringify([before, after])).toBe(saved);
    after.tests[0].annotations[0].description = 'EXAMPLE-456';
    after.tests[0].steps[0].title = 'reads the live order book';
    expect(diffInventories(before, after).changes[0].changedFields).toEqual(['annotations', 'steps']);
  });
  it('keeps records without bodies unmatched and orders several clone groups deterministically', () => {
    const before = inventory(`${code}\ntest.todo('reports overnight margin');`);
    before.tests.push({ ...before.tests[0], id: '1111111111111111' }, { ...before.tests[1], id: '2222222222222222' });
    const after = structuredClone(before);
    after.tests[2].id = '3333333333333333';
    after.tests[2].title = 'reports intraday margin';
    after.tests[2].fullName = after.tests[2].title;
    const result = diffInventories(before, after);
    expect(result.summary).toMatchObject({ added: 1, removed: 1, unchanged: 4 });
    expect(result.clones.before).toHaveLength(2);
    expect(
      diffInventories(
        { ...before, tests: [...before.tests].reverse() },
        { ...after, tests: [...after.tests].reverse() },
      ),
    ).toEqual(result);
  });

  it('refuses a complete inventory with a different schema version and cyclic metadata', () => {
    const before = inventory();
    Object.assign(before, { schemaVersion: 2 });
    expect(() => diffInventories(before, inventory())).toThrow('complete schema v1');
    const cyclic = inventory();
    Object.assign(cyclic.tests[0], { meta: cyclic });
    expect(() => diffInventories(cyclic, inventory())).toThrow('complete schema v1');
  });
  it('escapes project text in Markdown tables and reports warnings without interpreting them', () => {
    const before = inventory();
    const after = inventory(code.replace('quotes the bid', '<script>**[bid]** | `quote`_\\\\venue\\nrow'));
    const report = formatDiffMarkdown(diffInventories(before, after));
    expect(report).toContain('&lt;script&gt;');
    expect(report).toContain('&#124;');
    expect(report).toContain('&#96;');
    expect(report).toContain('&#42;');
    expect(report).toContain('&#91;');
    expect(report).toContain('&#95;');
    expect(report).toContain('&#92;');
    expect(report).not.toContain('<script>');
    expect(formatDiffMarkdown(diffInventories(before, before))).not.toContain('| ---');
    const missing = inventory('invalid {');
    expect(formatDiffMarkdown(diffInventories(before, missing))).toContain('At least one scan has errors');
  });

  it('does not infer enablement from a test that never loaded, and reports added metadata keys', () => {
    const before = inventory();
    const after = structuredClone(before);
    before.tests[0].state = 'notLoaded';
    before.tests[0].isActive = false;
    before.tests[0].isNotLoaded = true;
    after.tests[0].state = 'skip';
    after.tests[0].isActive = false;
    after.tests[0].isSkipped = true;
    Object.assign(after.tests[1], { futureMetadata: 'paper venue' });
    const result = diffInventories(before, after);
    expect(result.summary).toMatchObject({ newlySkipped: 0, reEnabled: 0, stateChanged: 1, metadataChanged: 1 });
  });
  it('ignores line moves and object-key order without changing either input', () => {
    const before = inventory();
    const after = inventory(`\n\n${code}`);
    const saved = JSON.stringify([before, after]);
    const result = diffInventories(before, after);
    expect(result.changes).toEqual([]);
    expect(result.summary).toMatchObject({ unchanged: 2, changed: 0, added: 0, removed: 0 });
    expect(JSON.stringify([before, after])).toBe(saved);
  });

  it('reports a renamed and moved test by its unique body, alongside additions and removals', () => {
    const before = inventory();
    const after = inventory(
      code
        .replace('quotes the bid', 'prices the bid')
        .replace(
          "test('quotes the ask', () => expect(187.75).toBeGreaterThan(0));",
          "test('rejects a crossed spread', () => expect(2 > 1).toBe(true));",
        ),
      'tests/market-data.test.ts',
    );
    const result = diffInventories(before, after);
    expect(result.summary).toMatchObject({ renamed: 1, moved: 1, changed: 1, added: 1, removed: 1 });
    const renamed = result.changes.find(({ match }) => match === 'bodyHash');
    expect(renamed).toMatchObject({
      before: { title: 'quotes the bid' },
      after: { title: 'prices the bid' },
    });
    expect(renamed?.kinds).toEqual(expect.arrayContaining(['renamed', 'moved']));
  });

  it('reports changed code, dependencies, tags, state and settings for a stable id', () => {
    const before = inventory();
    const after = structuredClone(before);
    Object.assign(after.tests[0], {
      bodyHash: '1111111111111111',
      dependencyHash: '2222222222222222',
      tags: ['@smoke'],
      state: 'skip',
      isActive: false,
      isSkipped: true,
      timeout: 5000,
    });
    const result = diffInventories(before, after);
    expect(result.summary).toMatchObject({
      changed: 1,
      unchanged: 1,
      bodyChanged: 1,
      dependenciesChanged: 1,
      tagsChanged: 1,
      newlySkipped: 1,
      stateChanged: 1,
      metadataChanged: 1,
    });
    expect(diffInventories(after, before).summary.reEnabled).toBe(1);
  });

  it('keeps ambiguous clone bodies as additions and removals', () => {
    const before = inventory(code.replaceAll(/expect\(187\.(25|75)\)/g, 'expect(100)'));
    const after = inventory(code.replaceAll(/expect\(187\.(25|75)\)/g, 'expect(100)').replaceAll('quotes', 'prices'));
    const result = diffInventories(before, after);
    expect(result.summary).toMatchObject({ added: 2, removed: 2, changed: 0 });
    expect(result.clones.before).toHaveLength(1);
    expect(result.clones.before[0].testIds).toHaveLength(2);
  });

  it('uses file context to distinguish identical bodies', () => {
    const before = inventory();
    before.tests[1].bodyHash = before.tests[0].bodyHash;
    before.tests[1].relativeFilePath = 'tests/venues.test.ts';
    const after = structuredClone(before);
    for (const [index, test] of after.tests.entries()) {
      test.id = String(index + 1).repeat(16);
      test.title += ' after reconnect';
      test.fullName = test.title;
    }
    expect(diffInventories(before, after).changes.map(({ match }) => match)).toEqual([
      'bodyHashAndFile',
      'bodyHashAndFile',
    ]);
  });

  it('does not compare hashes across tool versions and warns about scan errors', () => {
    const before = inventory();
    const after = inventory(code.replace('187.25', '188.25'));
    after.tool.version = `${before.tool.version}-EXAMPLE`;
    after.diagnostics.push({
      code: 'parse-error',
      level: 'error',
      relativeFilePath: 'tests/orders.test.ts',
      lineStart: null,
      columnStart: null,
      testId: null,
      source: null,
      message: 'Incomplete order test',
    });
    const result = diffInventories(before, after);
    expect(result.hashesComparable).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });

  it('treats tag order as a set and compares nested metadata by key rather than serialization order', () => {
    const before = inventory();
    const after = structuredClone(before);
    before.tests[0].tags = ['@smoke', '@quotes'];
    after.tests[0].tags = ['@quotes', '@smoke'];
    before.tests[0].meta = { venue: 'paper', risk: { limit: 100, currency: 'USD' } };
    after.tests[0].meta = { risk: { currency: 'USD', limit: 100 }, venue: 'paper' };
    expect(diffInventories(before, after).changes).toEqual([]);
  });

  it('rejects scans from different frameworks', () => {
    const before = inventory();
    const after = structuredClone(before);
    after.framework = 'jest';
    expect(() => diffInventories(before, after)).toThrow(TypeError);
  });

  it.each([null, [], {}, { schemaVersion: 2 }, { ...inventory(), tests: [{ id: 'missing-record' }] }])(
    'rejects an incomplete or invalid inventory: %j',
    (value) => {
      expect(() => diffInventories(value as Inventory, inventory())).toThrow('complete schema v1 JSON inventory');
    },
  );

  it('rejects combined inventories that repeat ids', () => {
    const before = inventory();
    before.tests.push(before.tests[0]);
    expect(() => diffInventories(before, inventory())).toThrow('duplicate test ids');
  });
});
