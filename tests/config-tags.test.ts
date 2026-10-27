import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { testNamed } from './helpers.ts';
import { project, VITEST_PACKAGE } from './project.ts';

async function scanned(config: string, files: Record<string, string>, version?: string): Promise<Inventory> {
  const manifest = version ? JSON.stringify({ devDependencies: { vitest: version } }) : VITEST_PACKAGE;
  return scan({
    root: project({ 'package.json': manifest, 'vitest.config.ts': config, ...files }),
    patterns: ['tests/*.test.ts'],
    framework: 'vitest',
  });
}

// Vitest reads the comment anywhere in a file's text, also in a string, so it is put together.
const MODULE_TAG = ['@module', 'tag'].join('-');

const codes = (inventory: Inventory) => inventory.diagnostics.map((diagnostic) => diagnostic.code);

const BROKER = [
  "import { describe, test } from 'vitest';",
  "describe('broker', () => {",
  "  test('reconnects after a dropped session', { tags: ['flaky'] }, () => {});",
  "  test('rejects an expired token', { tags: ['slow-db'] }, () => {});",
  "  test('sends a heartbeat', () => {});",
  '});',
  '',
].join('\n');

describe('Vitest tags the config defines', () => {
  it('sets the state of the tests that carry a tag, from the config, without a warning', async () => {
    const inventory = await scanned(
      [
        'export default {',
        '  test: {',
        '    tags: [',
        "      { name: 'flaky', description: 'Fails now and then on the demo feed', skip: true },",
        "      { name: 'slow-db', todo: true },",
        '    ],',
        '  },',
        '};',
        '',
      ].join('\n'),
      { 'tests/broker.test.ts': BROKER },
    );
    expect(inventory.tests.map((test) => [test.title, test.state, test.stateSource, test.stateLine])).toEqual([
      ['reconnects after a dropped session', 'skip', 'config', null],
      ['rejects an expired token', 'todo', 'config', null],
      ['sends a heartbeat', 'active', null, null],
    ]);
    expect(codes(inventory)).toEqual([]);
  });

  it('takes run settings, the mode, only and meta from tags, the lowest priority number winning', async () => {
    const inventory = await scanned(
      [
        'export default {',
        '  test: {',
        '    sequence: { concurrent: true },',
        '    tags: [',
        "      { name: 'flaky', retry: 2, timeout: 20_000, meta: { owner: 'market-data' } },",
        "      { name: 'slow-db', timeout: 60_000, repeats: 1, concurrent: true, priority: 1, meta: { db: 'postgres' } },",
        "      { name: 'paper', timeout: 30_000, priority: 2 },",
        "      { name: 'focus', only: true, fails: true, concurrent: false },",
        '    ],',
        '  },',
        '};',
        '',
      ].join('\n'),
      {
        'tests/broker.test.ts': [
          "import { test } from 'vitest';",
          "test('reconnects after a dropped session', { tags: ['paper', 'flaky', 'slow-db'], meta: { owner: 'trading' } }, () => {});",
          "test('rejects an expired token', { tags: ['focus'] }, () => {});",
          '',
        ].join('\n'),
      },
    );
    expect(testNamed(inventory, 'reconnects after a dropped session')).toMatchObject({
      timeout: 60_000,
      timeoutSource: 'config',
      retries: 2,
      retriesSource: 'config',
      repeats: 1,
      repeatsSource: 'config',
      isParallel: true,
      meta: { owner: 'trading', db: 'postgres' },
    });
    expect(testNamed(inventory, 'rejects an expired token')).toMatchObject({
      isOnly: true,
      isParallel: false,
      state: 'expectedToFail',
      stateSource: 'config',
    });
  });

  it("lets a test's own options beat its tags, and the describe's beat them only before Vitest 5", async () => {
    const config = "export default { test: { tags: [{ name: 'slow-db', timeout: 60_000 }] } };\n";
    const files = {
      'tests/broker.test.ts': [
        "import { describe, test } from 'vitest';",
        "describe('broker', { timeout: 5_000 }, () => {",
        "  test('rejects an expired token', { tags: ['slow-db'] }, () => {});",
        "  test('sends a heartbeat', { tags: ['slow-db'], timeout: 1_000 }, () => {});",
        '});',
        '',
      ].join('\n'),
    };
    const timeouts = (inventory: Inventory) =>
      inventory.tests.map((test) => [test.title, test.timeout, test.timeoutSource]);
    expect(timeouts(await scanned(config, files))).toEqual([
      ['rejects an expired token', 60_000, 'config'],
      ['sends a heartbeat', 1_000, 'test'],
    ]);
    expect(timeouts(await scanned(config, files, '4.1.12'))).toEqual([
      ['rejects an expired token', 5_000, 'suite'],
      ['sends a heartbeat', 1_000, 'test'],
    ]);
  });

  it('fails the file at the first use of a tag the config does not define, unless strictTags is off', async () => {
    const files = {
      'tests/broker.test.ts': [
        `// ${MODULE_TAG} broker`,
        "import { describe, test } from 'vitest';",
        "describe('session', { tags: ['flaky'] }, () => {",
        "  test('reconnects after a dropped session', { tags: ['flaky', 'slow-db'] }, () => {});",
        '});',
        '',
      ].join('\n'),
    };
    const strict = await scanned("export default { test: { tags: [{ name: 'broker' }] } };\n", files);
    expect(strict.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.level, diagnostic.lineStart])).toEqual([
      ['undefined-tag', 'error', 3],
      ['undefined-tag', 'error', 4],
    ]);
    expect(strict.diagnostics[0].message).toBe(
      'The Vitest config doesn\'t define the tag "flaky", so with strictTags Vitest fails the file while it loads, and none of its tests run.',
    );
    expect(strict.tests[0]).toMatchObject({ state: 'notLoaded', stateSource: 'file', stateLine: 3 });
    const bare = await scanned('export default { test: {} };\n', files);
    expect(bare.diagnostics.map((diagnostic) => [diagnostic.lineStart, diagnostic.message.split(',')[0]])).toEqual([
      [1, 'The Vitest config doesn\'t define the tag "broker"'],
      [3, 'The Vitest config doesn\'t define the tag "flaky"'],
      [4, 'The Vitest config doesn\'t define the tag "slow-db"'],
    ]);
    const loose = await scanned('export default { test: { strictTags: false } };\n', files);
    expect(codes(loose)).toEqual([]);
    expect(loose.tests[0].state).toBe('active');
  });

  it("keeps the warning when the scan can't work out the tags, or the projects define different ones", async () => {
    const files = { 'tests/broker.test.ts': BROKER };
    const unknown = [
      "import { brokerTags } from './tags.config';",
      'export default { test: { tags: brokerTags } };',
      '',
    ].join('\n');
    const configs = [
      unknown,
      "export default { test: { strictTags: process.env.CI === 'true' } };\n",
      "export default { test: { tags: [{ name: 'flaky', skip: !!process.env.CI }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', retry: { count: 2, condition: (error) => error.message.includes('ECONNRESET') } }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', timeout: process.env.CI ? 60_000 : 20_000 }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', meta: { owner: process.env.OWNER } }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', meta: 'market-data' }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', meta: { feeds: ['demo', process.env.FEED] } }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', retry: Number(process.env.RETRIES) }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: ['flaky', 'slow-db'] } };\n",
      [
        "import { sharedTag } from '@trading/test-config';",
        "export default { test: { tags: [{ ...sharedTag, name: 'flaky' }, { name: 'slow-db' }] } };",
        '',
      ].join('\n'),
      "export default { test: { tags: [{ name: 'flaky', priority: Number(process.env.PRIORITY) }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: process.env.TAG }, { name: 'slow-db' }] } };\n",
      'export default { test: { tags: [...process.env.TAGS] } };\n',
      'export default { test: { tags: process.env.TAGS } };\n',
      [
        'export default {',
        '  test: {',
        '    projects: [',
        "      { test: { name: 'unit', tags: [{ name: 'flaky' }, { name: 'slow-db' }] } },",
        "      { test: { name: 'integration', tags: [{ name: 'flaky', skip: true }, { name: 'slow-db' }] } },",
        '    ],',
        '  },',
        '};',
        '',
      ].join('\n'),
    ];
    for (const config of configs) {
      const inventory = await scanned(config, files);
      expect(
        codes(inventory).filter((code) => code !== 'config-value-unknown'),
        config,
      ).toEqual(['config-may-change-state']);
      expect(inventory.tests[0].state, config).toBe('active');
    }
  });

  it('reads tag meta with lists and nested objects, and tags shared by the projects', async () => {
    const inventory = await scanned(
      [
        "const tags = [{ name: 'flaky', meta: { feeds: ['demo', 'paper'], limits: { retries: 3 } } }, { name: 'slow-db' }];",
        'export default {',
        "  test: { tags, projects: [{ extends: true, test: { name: 'unit' } }, { extends: true, test: { name: 'e2e' } }] },",
        '};',
        '',
      ].join('\n'),
      { 'tests/broker.test.ts': BROKER },
    );
    expect(testNamed(inventory, 'reconnects after a dropped session').meta).toEqual({
      feeds: ['demo', 'paper'],
      limits: { retries: 3 },
    });
    expect(codes(inventory)).toEqual([]);
  });
});
