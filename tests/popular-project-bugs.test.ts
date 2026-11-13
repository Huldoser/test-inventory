import { describe, expect, it } from 'vitest';
import { scan } from '../src/index.ts';
import { codes, scanJest, scanNode, scanPlaywright, scanVitest } from './helpers.ts';
import { PLAYWRIGHT_PACKAGE, project } from './project.ts';

describe('real-project declaration regressions', () => {
  it.each([
    "import { test } from 'node:test';",
    "import { it as test } from 'node:test';",
    "const { test } = require('node:test');",
    "const { it: test } = require('node:test');",
  ])('reads the module members on a named node:test function: %s', (binding) => {
    const result = scanNode(`${binding}
test.before(() => {});
test.after(() => {});
test.beforeEach(() => {});
test.afterEach(() => {});
test.describe('order book', () => {
  test.it('retains the best bid', () => {});
  test.suite('limit orders', () => {
    test('fills at the limit price', () => {});
  });
});`);
    expect(result.tests.map(({ fullName, state }) => [fullName, state])).toEqual([
      ['order book > retains the best bid', 'active'],
      ['order book > limit orders > fills at the limit price', 'active'],
    ]);
    expect(result.tests[0].hooks).toMatchObject({ beforeAll: 1, afterAll: 1, beforeEach: 1, afterEach: 1 });
    expect(codes(result)).toEqual([]);
  });

  it('reads a conditional Jest each factory before its declaration call', () => {
    const source = `
(process.env.MARKET_CLOSED ? it.skip.each : it.each)(['buy', 'sell'])(
  'routes a %s order', () => {}
);
it('retains an alert after restart', () => {});`;
    const result = scanJest(source);
    expect(result.tests).toHaveLength(2);
    expect(result.tests[0]).toMatchObject({ isParameterized: true, caseCount: 2, state: 'active' });
    expect(result.tests[1]).toMatchObject({ title: 'retains an alert after restart', state: 'active' });
    expect(codes(result)).toEqual([]);
  });

  it.each([
    '(process.env.MARKET_CLOSED ? it.skip.each : it.each)',
    '(process.env.MARKET_CLOSED && it.skip.each || it.each)',
    '(0, it.each)',
    'detachedEach',
  ])('refuses a Vitest table factory called without its test receiver: %s', (factory) => {
    const result = scanVitest(`import { it } from 'vitest';
const detachedEach = it.each;
${factory}(['buy', 'sell'])('routes a %s order', () => {});
it('retains the order book', () => {});`);
    expect(codes(result)).toContain('invalid-chain');
    expect(result.tests.find(({ title }) => title === 'retains the order book')?.state).toBe('notLoaded');
  });

  it('does not claim duplicate Playwright titles from an unknown iteration count', () => {
    const result = scanPlaywright(`import { test } from '@playwright/test';
marketThemes().forEach(() => {
  test.describe('order ticket', () => {
    test('submits a market order', async () => {});
  });
});`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].state).toBe('active');
    expect(codes(result)).toEqual(['test-in-loop']);
  });

  it('does not invent a returned test factory from an ordinary conditional Jest declaration', () => {
    const result = scanJest(`
(process.env.MARKET_CLOSED ? it.skip : it)(['buy'])('routes a limit order', () => {});
it('retains the order book', () => {});`);
    expect(result.tests.some(({ title }) => title === 'routes a limit order')).toBe(false);
    expect(codes(result)).toEqual(['test-without-body']);
  });

  it('does not diagnose destructured generated utilities as unresolved Playwright imports', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/orders.spec.ts': `import { test } from '@playwright/test';
import { prices } from '../generated/prices';
const { normalizePrice } = prices;
const price = normalizePrice('125.00');
test('submits a limit order', async () => {});`,
    });
    const result = await scan({ root, framework: 'playwright', patterns: ['tests/*.spec.ts'] });
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].state).toBe('active');
    expect(codes(result)).not.toContain('unresolved-test-import');
  });

  it.each(['describe', 'describe: orders', 'beforeAll: orders'])(
    'does not invent a test from an unresolved destructured Playwright member: %s',
    async (member) => {
      const root = project({
        'package.json': PLAYWRIGHT_PACKAGE,
        'helpers/playwright.ts': `import { test as base } from '@playwright/test';
function wrapper(...args: unknown[]) { return base(...args); }
wrapper.describe = base.describe;
wrapper.beforeAll = base.beforeAll;
export const test = wrapper;`,
        'tests/orders.spec.ts': `import { test } from '../helpers/playwright';
const { ${member} } = test;
${member === 'describe' ? 'describe' : 'orders'}('order ticket', () => {
  test('submits a market order', async () => {});
});`,
      });
      const result = await scan({ root, framework: 'playwright', patterns: ['tests/*.spec.ts'] });
      expect(result.tests).toEqual([]);
      expect(codes(result)).toContain('unresolved-test-import');
      expect(codes(result)).not.toContain('nested-test');
    },
  );

  it.each([
    'async function seedOrders() { await Promise.resolve(); }',
    'function seedOrders() { return async () => { await Promise.resolve(); }; }',
    'async function* seedOrders() { await Promise.resolve(); }',
  ])('ignores awaits inside a nested function declaration: %s', (helper) => {
    const result = scanPlaywright(`import { test } from '@playwright/test';
test.describe('order history', async () => {
  ${helper}
  test('lists fills newest first', async () => {});
});`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].state).toBe('active');
    expect(codes(result)).toEqual([]);
  });
});
