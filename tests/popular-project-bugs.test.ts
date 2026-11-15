import { describe, expect, it } from 'vitest';
import { scan } from '../src/index.ts';
import { codes, scanJasmine, scanJest, scanMocha, scanNode, scanPlaywright, scanVitest } from './helpers.ts';
import { PLAYWRIGHT_PACKAGE, project } from './project.ts';

describe('real-project declaration regressions', () => {
  it.each([
    "import playwright from '@playwright/test';",
    "import { test as playwright } from '@playwright/test';",
    "const playwright = require('@playwright/test');",
    "const { test: playwright } = require('@playwright/test');",
    "import { test as original } from '@playwright/test'; const playwright = original;",
  ])('does not read the Playwright module defineConfig call as an invalid test: %s', (binding) => {
    const result = scanPlaywright(`${binding}
const config = playwright.defineConfig({ testDir: './tests' });
playwright('submits a market order', async () => {});`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].state).toBe('active');
    expect(codes(result)).toEqual([]);
  });

  it.each([
    "const playwright = require('@playwright/test');",
    "import playwright from '@playwright/test';",
    "import { test as playwright } from '@playwright/test';",
  ])('reads the Playwright module browser and request exports as library calls: %s', (binding) => {
    const result = scanPlaywright(`${binding}
async function openBrokerApi() {
  const browser = await playwright.chromium.launch({ headless: true });
  const api = await playwright.request.newContext({ baseURL: 'https://broker.example' });
  return { browser, api };
}
playwright('submits a market order', async () => {});`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].state).toBe('active');
    expect(codes(result)).toEqual([]);
  });

  it('does not give module exports to an extended Playwright test function', () => {
    const result = scanPlaywright(`import { test } from '@playwright/test';
const accountTest = test.extend({});
accountTest.defineConfig({ testDir: './tests' });
accountTest.chromium.launch();
accountTest('submits an order in the account', async () => {});`);
    expect(codes(result)).toContain('invalid-chain');
    expect(result.tests[0].state).toBe('notLoaded');
  });

  it('keeps tests when a local require factory is called without arguments', () => {
    const result = scanVitest(`import { it } from 'vitest';
function require() { return { symbol: 'EXAMPLE' }; }
const quote = require();
it('normalizes a market quote', () => { quote.symbol; });`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]).toMatchObject({ title: 'normalizes a market quote', state: 'active' });
    expect(codes(result)).not.toContain('internal-error');
  });

  it('does not take module members from a parameter that shadows a node:test import', () => {
    const result = scanNode(`import nodeTest from 'node:test';
function registerModel(nodeTest) {
  const { describe: record } = nodeTest;
  record('order schema', () => {});
}
registerModel({ describe() {} });
nodeTest('routes a limit order', () => {});`);
    expect(result.tests.map(({ title }) => title)).toEqual(['routes a limit order']);
    expect(codes(result)).toEqual([]);
  });

  it.each([
    "const nodeTest = require('node:test');",
    "import nodeTest from 'node:test';",
    "import { test as nodeTest } from 'node:test';",
  ])('reads members destructured from a bound node:test module: %s', (binding) => {
    const result = scanNode(`${binding}
const { describe: orders, it: order, before } = nodeTest;
before(() => {});
orders('limit orders', () => {
  order('fills at the limit price', () => {});
});`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]).toMatchObject({ fullName: 'limit orders > fills at the limit price', state: 'active' });
    expect(result.tests[0].hooks.beforeAll).toBe(1);
    expect(codes(result)).toEqual([]);
  });

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

describe("another runner's built-in test module", () => {
  it.each([
    ['node:test', 'bun:test', scanNode],
    ['Jest', 'node:test', scanJest],
    ['Jest', 'bun:test', scanJest],
    ['Jest', 'mocha', scanJest],
    ['Vitest', 'node:test', scanVitest],
    ['Vitest', 'bun:test', scanVitest],
    ['Vitest', 'mocha', scanVitest],
    ['Mocha', 'node:test', scanMocha],
    ['Mocha', 'bun:test', scanMocha],
    ['Jasmine', 'node:test', scanJasmine],
    ['Jasmine', 'bun:test', scanJasmine],
    ['Playwright', 'node:test', scanPlaywright],
    ['Playwright', 'bun:test', scanPlaywright],
    ['Playwright', 'mocha', scanPlaywright],
  ])('is a framework mismatch in a %s scan, not a missing test import: %s', (_, source, scanWith) => {
    const result = scanWith(`import { describe, it } from '${source}';
describe('order routing', () => {
  it('routes a limit order to the primary venue', () => {});
});`);
    expect(codes(result)).toEqual(['framework-mismatch']);
    expect(result.diagnostics[0].message).toMatch(new RegExp(`^The file imports '${source}', but the scan is for `));
  });
});

describe("a test object another runner's module builds, reached through local files", () => {
  it.each([
    [
      'jest',
      'Jest',
      'builds',
      "import { test as base } from '@playwright/test';\nexport const test = base.extend({ account: async ({}, use) => use('EXAMPLE') });\n",
      '@playwright/test',
    ],
    ['vitest', 'Vitest', 're-exports', "export { test } from 'node:test';\n", 'node:test'],
    ['playwright', 'Playwright', 're-exports', "export { test } from 'vitest';\n", 'vitest'],
  ] as const)('is a framework mismatch in a %s scan', async (framework, name, how, base, source) => {
    const root = project({
      'package.json': JSON.stringify({
        devDependencies: { jest: '30.2.0', vitest: '5.0.3', '@playwright/test': '1.63.0' },
      }),
      'tests/support/base.ts': base,
      'tests/support/fixtures.ts': "export { test } from './base';\n",
      'tests/orders.spec.ts':
        "import { test } from './support/fixtures';\ntest('places a market order', async () => {});\n",
    });
    const inventory = await scan({ root, framework, patterns: ['tests/orders.spec.ts'] });
    expect(inventory.diagnostics.map((item) => [item.code, item.message])).toEqual([
      [
        'framework-mismatch',
        `'test' is imported from './support/fixtures', which re-exports it from './base', which ${how} it from '${source}', another runner's module, but the scan is for ${name}.`,
      ],
    ]);
    expect(inventory.tests).toEqual([]);
  });
});

describe("a helper from a module that imports another runner's module", () => {
  const helpers = [
    "import { expect, test } from '@playwright/test';",
    "export function seedOrder(symbol) { return { symbol, side: 'buy', quantity: 100 }; }",
    "export function describeOrderPage(title) { test.describe(title, () => { test('opens the order page', async () => {}); }); }",
    "export const expectFilled = (order) => expect(order.status).toBe('filled');",
  ].join('\n');

  it("is no mismatch when the helper the file calls doesn't use that import", async () => {
    const root = project({
      'package.json': JSON.stringify({ packageManager: 'bun@1.4.4', scripts: { test: 'bun test' } }),
      'support/orders.ts': helpers,
      'orders.test.ts': `import { describe, test } from 'bun:test';
import { seedOrder } from './support/orders';
describe('order book', () => {
  seedOrder('AAPL');
  test('fills a limit order at the limit price', () => {});
});`,
    });
    const inventory = await scan({ root, framework: 'bun', patterns: ['orders.test.ts'] });
    expect(inventory.tests.map((test) => test.title)).toEqual(['fills a limit order at the limit price']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('is a mismatch at the call when the helper uses it', async () => {
    const root = project({
      'package.json': JSON.stringify({ packageManager: 'bun@1.4.4', scripts: { test: 'bun test' } }),
      'support/orders.ts': helpers,
      'orders.test.ts': `import { test } from 'bun:test';
import { describeOrderPage } from './support/orders';
describeOrderPage('order page');
test('fills a limit order at the limit price', () => {});`,
    });
    const inventory = await scan({ root, framework: 'bun', patterns: ['orders.test.ts'] });
    expect(inventory.diagnostics.map((item) => [item.code, item.lineStart])).toEqual([['framework-mismatch', 3]]);
  });
});

describe('a var declared in a nested block, which belongs to the whole function', () => {
  it.each([
    [
      'a switch case',
      `function quoteImage(image) {
  switch (image.kind) {
    case 'canvas':
      var context = image.canvas.getContext('2d');
      context.drawImage(image.bitmap, 0, 0);
      return context.getImageData(0, 0, image.width, image.height);
    default:
      return null;
  }
}`,
    ],
    [
      'an if block, read after it',
      `function quoteImage(image) {
  if (image.canvas) {
    var context = image.canvas.getContext('2d');
  }
  return context.getImageData(0, 0, image.width, image.height);
}`,
    ],
    [
      'an if block that gives a parameter a default',
      `function quoteImage(image, context) {
  if (!context) {
    var context = image.canvas.getContext('2d');
  }
  return context.getImageData(0, 0, image.width, image.height);
}`,
    ],
  ])('hides the Mocha global it is named after, in %s', (_, helper) => {
    const result = scanMocha(`${helper}
describe('quote images', () => {
  it('renders the last trade price', () => {});
});`);
    expect(result.tests.map((test) => [test.title, test.state])).toEqual([['renders the last trade price', 'active']]);
    expect(codes(result)).toEqual([]);
  });
});
