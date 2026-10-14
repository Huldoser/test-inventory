import { symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, scanSource, type ScanOptions } from '../src/index.ts';
import { findFiles, normalizePattern } from '../src/files.ts';
import { scanFile } from '../src/scan-file.ts';
import { expectValidInventory, onlyTest } from './helpers.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

const SPEC = "import { test } from '@playwright/test';\ntest('fills an order', async () => {});\n";

async function scanProject(root: string, options: Partial<ScanOptions> = {}) {
  const inventory = await scan({ root, patterns: ['tests/**/*.spec.ts'], framework: 'playwright', ...options });
  expectValidInventory(inventory);
  return inventory;
}

/**
 * Barrels in twelve layers of four, each re-exporting all four of the next layer, so that a search that misses them
 * passes 4^11 paths through them. They end in `layer-0-0.ts`.
 */
function barrels(folder: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (let layer = 0; layer < 12; layer++) {
    for (let index = 0; index < 4; index++) {
      files[`${folder}/layer-${layer}-${index}.ts`] =
        layer < 11
          ? [0, 1, 2, 3].map((next) => `export * from './layer-${layer + 1}-${next}';\n`).join('')
          : "export const MARKET_OPEN = '09:30';\n";
    }
  }
  return files;
}

describe('scan', () => {
  it('finds files by glob, sorted, with / in paths, leaving out node_modules and ignored files', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/watchlist.spec.ts': SPEC,
      'tests/orders/market.spec.ts': SPEC,
      'tests/alerts.spec.ts': SPEC,
      'tests/legacy/old.spec.ts': SPEC,
      'tests/node_modules/pkg/vendored.spec.ts': SPEC,
    });
    const inventory = await scanProject(root, { ignore: ['tests/legacy/**'] });
    expect(inventory.tests.map((test) => test.relativeFilePath)).toEqual([
      'tests/alerts.spec.ts',
      'tests/orders/market.spec.ts',
      'tests/watchlist.spec.ts',
    ]);
    expect(inventory.summary.fileCount).toBe(3);
    expect(inventory.frameworkVersion).toBe('1.63.0');
  });

  it('uses the current directory as the default root', async () => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/a.spec.ts': SPEC });
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const inventory = await scan({ patterns: ['tests/*.spec.ts'], framework: 'playwright' });
      expect(inventory.summary.testCount).toBe(1);
    } finally {
      process.chdir(cwd);
    }
  });

  it('reports parse errors and keeps the tests the parser could still read', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/broken.spec.ts':
        "import { test } from '@playwright/test';\ntest('fills', async () => {\n  const = 1;\n});\n",
      'tests/partial.spec.ts': `${SPEC}return;\n`,
      'tests/unfinished.spec.ts': "import { test } from '@playwright/test';\ntest('fills', async () => {\n",
    });
    const inventory = await scanProject(root);
    expect(
      inventory.diagnostics.map((diagnostic) => [diagnostic.relativeFilePath, diagnostic.code, diagnostic.lineStart]),
    ).toEqual([
      ['tests/broken.spec.ts', 'parse-error', 3],
      ['tests/partial.spec.ts', 'parse-error', 3],
      ['tests/unfinished.spec.ts', 'parse-error', 3],
    ]);
    expect(inventory.diagnostics[2]).toMatchObject({ source: null, columnStart: 1 });
    expect(inventory.diagnostics[0]).toMatchObject({
      message: 'The file could not be parsed: Unexpected token',
      source: '=',
    });
    expect(inventory.tests.map((test) => test.relativeFilePath)).toEqual(['tests/partial.spec.ts']);
  });

  it('skips files that are not JavaScript or TypeScript, with a warning for each', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/orders.spec.ts': SPEC,
      'tests/README.md': '# Order tests',
      'tests/data/symbols.json': '{ "symbols": ["AAPL"] }',
    });
    const inventory = await scanProject(root, { patterns: ['tests/**/*'] });
    expect(inventory.summary.fileCount).toBe(1);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.relativeFilePath])).toEqual([
      ['unsupported-file', 'tests/README.md'],
      ['unsupported-file', 'tests/data/symbols.json'],
    ]);
  });

  it('warns when no file matches the patterns', async () => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts': SPEC });
    const inventory = await scanProject(root, { patterns: ['e2e/**/*.spec.ts', 'smoke/*.spec.ts'] });
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'no-files-matched',
        level: 'warning',
        relativeFilePath: '.',
        message: 'No test files match "e2e/**/*.spec.ts", "smoke/*.spec.ts" in the root.',
      },
    ]);
  });

  it('does not report a folder that a pattern names and that does not exist as unreadable', async () => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts': SPEC });
    for (const pattern of ['e2e/**/*.spec.ts', 'tests/orders.spec.ts/**/*.ts']) {
      const inventory = await scanProject(root, { patterns: [pattern] });
      expect(inventory.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['no-files-matched']);
    }
  });

  it.each([
    ['playwright', '1.63.0', 'tests', 'tests/**/*.spec.ts'],
    ['vitest', '5.0.3', 'src/', 'src/**/*.test.ts'],
  ] as const)('says how to scan the test files in a folder given as the pattern, for %s', async (...row) => {
    const [framework, frameworkVersion, pattern, example] = row;
    const root = project({
      'tests/orders.spec.ts': SPEC,
      'src/fees.test.ts': "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n",
    });
    const inventory = await scanProject(root, { patterns: [pattern], framework, frameworkVersion });
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'no-files-matched',
        message: `No test files match "${pattern}" in the root. "${pattern}" is a folder; to scan the test files in it, use a pattern such as "${example}".`,
      },
    ]);
  });

  it('does not read files inside a folder named like a test file', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/checkout.spec.ts': SPEC,
      'tests/checkout.spec.ts-snapshots/order-summary.png': 'PNG',
      'tests/chart.spec.ts/candles.png': 'PNG',
    });
    const inventory = await scanProject(root);
    expect(inventory.summary.fileCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });
});

describe('scan follows a custom test object to its fixtures file', () => {
  const spec = (from: string) =>
    `import { test, expect } from '${from}';\ntest('shows the buying power', async ({ portfolioPage }) => {});\n`;

  it.each([
    [
      'a directory index',
      '../fixtures',
      {
        'fixtures/index.ts': "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n",
      },
    ],
    [
      'a .js specifier for a .ts file',
      '../fixtures/trading.js',
      {
        'fixtures/trading.ts':
          "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n",
      },
    ],
    [
      'a re-export',
      '../fixtures/reexport',
      { 'fixtures/reexport.ts': "export { test, expect } from '@playwright/test';\n" },
    ],
    [
      'a re-export of the default',
      '../fixtures/default-reexport',
      { 'fixtures/default-reexport.ts': "export { default as test } from '@playwright/test';\n" },
    ],
    ['an export star', '../fixtures/all', { 'fixtures/all.mts': "export * from '@playwright/test';\n" }],
    [
      'a renamed local export',
      '../fixtures/local',
      {
        'fixtures/local.ts':
          "import { test as base } from '@playwright/test';\nconst trading = base.extend({});\nexport { trading as test };\n",
      },
    ],
    [
      'a CommonJS re-export',
      '../fixtures/commonjs',
      { 'fixtures/commonjs.js': "'use strict';\nmodule.exports = require('@playwright/test');\n" },
    ],
  ])('through %s', async (_, from, files) => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/portfolio.spec.ts': spec(from), ...files });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.title)).toEqual(['shows the buying power']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it.each([
    ['.', 'tests/portfolio.spec.ts'],
    ['..', 'tests/portfolio/buying-power.spec.ts'],
  ])("through the index of the folder '%s'", async (from, file) => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      [file]: spec(from),
      'tests/index.ts': "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n",
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.title)).toEqual(['shows the buying power']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('follows a test object used with a title joined from strings', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/routing.spec.ts':
        "import { test } from '../fixtures';\nfor (const venue of ['NASDAQ', 'NYSE']) {\n  test(venue + ' rejects odd lots', async () => {});\n  test('routes market orders to ' + venue, async () => {});\n}\n",
      'fixtures/index.ts': "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n",
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => [test.title, test.isInLoop])).toEqual([
      ["venue + ' rejects odd lots'", true],
      ["'routes market orders to ' + venue", true],
    ]);
  });

  it('follows a default export', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/portfolio.spec.ts':
        "import test from '../fixtures/default';\ntest('shows the buying power', async () => {});\n",
      'fixtures/default.ts': "import { test as base } from '@playwright/test';\nexport default base.extend({});\n",
    });
    expect((await scanProject(root)).summary.testCount).toBe(1);
  });

  it.each([
    ['is missing', {}, 'could not be read'],
    ['is a directory without an index', { 'fixtures/empty/.keep': '' }, 'could not be read'],
    [
      'builds test in a way that is not recognized',
      {
        'fixtures/index.ts':
          "import { test as base } from '@playwright/test';\nexport const test = withAccount(base);\n",
      },
      'does not export a Playwright test object that could be recognized',
    ],
    [
      're-exports from a missing local file',
      { 'fixtures/index.ts': "export { test } from './base';\n" },
      "re-exports it from './base', which could not be read",
    ],
    [
      're-exports an import from a missing local file',
      { 'fixtures/index.ts': "import { test } from './base';\nexport { test };\n" },
      "re-exports it from './base', which could not be read",
    ],
    [
      'builds test from a missing local file',
      { 'fixtures/index.ts': "import { base } from './base';\nexport const test = base.extend({});\n" },
      "builds it from './base', which could not be read",
    ],
    [
      're-exports everything from a missing local file',
      { 'fixtures/index.ts': "export * from './base';\n" },
      "re-exports it from './base', which could not be read",
    ],
    [
      're-exports a missing module with CommonJS',
      { 'fixtures/index.js': "'use strict';\nmodule.exports = require('./vendor/playwright');\n" },
      "re-exports it from './vendor/playwright', which could not be read",
    ],
    [
      'exports a variable holding a test object built from a missing local file',
      {
        'fixtures/index.ts':
          "import { baseTest } from './base';\nconst browserTest = baseTest.extend({});\nexport const test = browserTest;\n",
      },
      "builds it from './base', which could not be read",
    ],
    [
      'renames a test object built from a missing local file',
      {
        'fixtures/index.ts':
          "import { baseTest } from './base';\nconst browserTest = baseTest.extend({});\nexport { browserTest as test };\n",
      },
      "builds it from './base', which could not be read",
    ],
    [
      'takes test from a member of an object from a missing local file',
      { 'fixtures/index.ts': "import { accounts } from './accounts';\nexport const test = accounts.paperTest;\n" },
      "builds it from './accounts', which could not be read",
    ],
    [
      'picks test with a condition, from a missing local file on either side',
      {
        'fixtures/index.ts':
          "import { paperTest } from './paper';\nexport const test = process.env.LIVE ? undefined : paperTest;\n",
      },
      "builds it from './paper', which could not be read",
    ],
    [
      'passes a test object from a missing local file to a helper, after a spread',
      {
        'fixtures/index.ts':
          "import { brokerFixtures } from './fixtures';\nimport { accountTest } from './accounts';\nexport const test = withBroker(...brokerFixtures, accountTest);\n",
      },
      "builds it from './accounts', which could not be read",
    ],
    [
      'builds test with an expression the scan does not follow',
      {
        'fixtures/index.ts':
          "import { test as base } from '@playwright/test';\nimport { fixtures } from './fixtures';\nexport const test = [base.extend(fixtures)][0];\n",
      },
      'does not export a Playwright test object that could be recognized',
    ],
    [
      'builds test from a local file that does not export one',
      {
        'fixtures/index.ts': "export { test } from './accounts';\n",
        'fixtures/accounts.ts': "import { test as paper } from './paper';\nexport const test = paper.extend({});\n",
        'fixtures/paper.ts': "export const test = { account: 'paper' };\n",
      },
      "re-exports it from './accounts', which builds it from './paper', which does not export a Playwright test object that could be recognized",
    ],
    [
      're-exports test from itself through another file',
      {
        'fixtures/index.ts': "export { test } from './accounts';\n",
        'fixtures/accounts.ts': "export { test } from './index';\n",
      },
      "re-exports it from './accounts', which re-exports it from './index', which imports it back, in a cycle",
    ],
    [
      'builds test from its own variables in a way that is not recognized',
      {
        'fixtures/index.ts':
          "import { test as base } from '@playwright/test';\nconst trader = withAccount(base);\nexport const test = mergeAccounts(trader, trader);\n",
      },
      'does not export a Playwright test object that could be recognized',
    ],
    [
      'requires Playwright and exports test with CommonJS',
      {
        'fixtures/index.js':
          "const { test: base } = require('@playwright/test');\nmodule.id = 'fixtures';\nexports.test = base.extend({});\n",
      },
      'does not export a Playwright test object that could be recognized',
    ],
    [
      'does not export the name',
      {
        'fixtures/index.ts':
          "import { test as base } from '@playwright/test';\nexport const trading = base.extend({});\nexport default 1;\nexport * as all from '@playwright/test';\n",
      },
      'does not export a Playwright test object that could be recognized',
    ],
    [
      'exports something else from Playwright under the name',
      { 'fixtures/index.ts': "export { expect, expect as test } from '@playwright/test';\n" },
      'does not export a Playwright test object that could be recognized',
    ],
    [
      'reaches it through more modules than are followed',
      Object.fromEntries(
        Array.from({ length: 17 }, (_, index): [string, string] => [
          index === 0 ? 'fixtures/index.ts' : `fixtures/layer-${index}.ts`,
          `export * from './layer-${index + 1}';\n`,
        ]),
      ),
      `${Array.from({ length: 16 }, (_, index) => `re-exports it from './layer-${index + 1}', which `).join('')}is more than 16 modules deep`,
    ],
    ['does not parse', { 'fixtures/index.ts': 'export const test = ;\n' }, 'could not be parsed'],
  ])('reports a fixtures file that %s', async (_, files, reason) => {
    const fixtures = Object.keys(files).some((name) => name.startsWith('fixtures/empty'))
      ? '../fixtures/empty'
      : '../fixtures';
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/portfolio.spec.ts': spec(fixtures), ...files });
    const inventory = await scanProject(root);
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'unresolved-test-import',
        message: `'test' is imported from '${fixtures}', which ${reason}; tests that use it are missing.`,
      },
    ]);
  });

  it('reports test functions and describes through modules it cannot follow, but not helpers or calls in tests', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/routing.spec.ts': [
        "import { test } from '@playwright/test';",
        "import { join } from 'node:path';",
        "import { formatQuote } from '../src';",
        "import { brokerTest, withMarketData } from '../missing';",
        "import { checkoutTest } from '../missing-checkout';",
        "import { base } from './broken';",
        "const venues = join('fixtures', fileName);",
        "formatQuote('AAPL', () => 'USD');",
        "withMarketData('AAPL', async () => {});",
        "brokerTest('routes a market order to NASDAQ', async () => {});",
        "base.describe('order routing', () => {});",
        "test('pays by card', async ({ page }) => {",
        "  await checkoutTest.step('enters the card number', async () => {});",
        '});',
        '',
      ].join('\n'),
      'src/index.ts': "export * from './quotes';\n",
      'tests/broken.ts': 'export const base = ;\n',
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.title)).toEqual(['pays by card']);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "'brokerTest' is imported from '../missing', which could not be read; tests that use it are missing.",
      "'base' is imported from './broken', which could not be parsed; tests that use it are missing.",
    ]);
  });

  it('reports a Vitest test function called through a member it does not know, or with a timeout after the body', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      // As a package that extends Vitest's `it` with methods of its own.
      'tests/support/trading-vitest.ts':
        "import * as internal from './internal';\nexport * from 'vitest';\nexport const it = internal.it;\n",
      'tests/orders.test.ts': [
        "import { describe, it } from './support/trading-vitest';",
        "import { ledgerTest } from './support/missing';",
        "describe('order fills', () => {",
        "  it.effect('fills a market order', () => {});",
        "  it.effect.skipIf(process.env.CI)('fills a limit order', () => {});",
        "  ledgerTest('records the fill in the ledger', async ({ ledger }) => {}, 60_000);",
        '});',
        '',
      ].join('\n'),
    });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.suites.map((suite) => suite.title)).toEqual(['order fills']);
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.lineStart])).toEqual([
      ['unresolved-test-import', 1],
      ['unresolved-test-import', 2],
    ]);
    expect(inventory.diagnostics[0].message).toBe(
      "'it' is imported from './support/trading-vitest', which does not export a Vitest test object that could be recognized; tests that use it are missing.",
    );
  });

  it('says nothing about a local module that has nothing to do with Playwright', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/quotes.spec.ts':
        "import { test } from '@playwright/test';\nimport { withRetry, poll, stressTest } from '../helpers/retry';\nwithRetry('quotes', async () => {});\npoll(async () => {});\nstressTest('flash crash', async () => {});\ntest('shows a quote', async () => {});\n",
      'helpers/retry.ts':
        'export function withRetry(name: string, run: () => Promise<void>) {}\nexport function poll() {}\nexport function stressTest(scenario: string, run: () => Promise<void>) {}\n',
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.title)).toEqual(['shows a quote']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads a describe function taken from a test object in a fixtures file', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/orders-table.spec.ts':
        "import { test } from '../fixtures';\nconst describeOnPlatform = process.env.PLATFORM ? test.describe.serial : test.describe;\ndescribeOnPlatform('orders table', () => {\n  test('sorts by symbol', async ({ page }) => {});\n});\n",
      'fixtures/index.ts': "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n",
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.fullName)).toEqual(['orders table > sorts by symbol']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('follows a body passed by name', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/certification.spec.ts':
        "import { test } from '@playwright/test';\nconst checkCertificate = async () => {};\ntest('shows the certificate', checkCertificate);\ntest.skip('hides an expired certificate', checkCertificate);\n",
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([
      ['shows the certificate', 'active'],
      ['hides an expired certificate', 'skip'],
    ]);
    // The function passed by name is in the file, so its code is hashed.
    expect(inventory.tests[0].bodyHash).toMatch(/^[0-9a-f]{16}$/);
    expect(inventory.tests[1].bodyHash).toBe(inventory.tests[0].bodyHash);
  });

  it('follows test objects through barrels and extend chains across files', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/portfolio.spec.ts': spec('../fixtures'),
      'fixtures/index.ts': "export * from './trading';\nexport { expect } from '@playwright/test';\n",
      'fixtures/trading.ts':
        "import { test as accounts } from './accounts';\nexport const test = accounts.extend<{ venue: string }>({ venue: 'NASDAQ' });\n",
      'fixtures/accounts.ts':
        "import { test as base } from './base';\nexport const test = base.extend({ account: 'paper' });\n",
      'fixtures/base.ts': "export { test } from '@playwright/test';\n",
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.title)).toEqual(['shows the buying power']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('recognizes a test object a test file builds from an imported one, without reading it on trust', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/orders.spec.ts':
        "import { test as base } from '../fixtures';\nconst buyTest = base.extend({ side: 'buy' });\nconst sellTest = base.extend({ side: 'sell' });\nbuyTest('places a market order', async ({ side }) => {});\nsellTest('closes a position', async ({ side }) => {});\n",
      'fixtures/index.ts':
        "import { test as base } from '@playwright/test';\nexport const test = base.extend({ account: 'paper' });\n",
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.title)).toEqual(['places a market order', 'closes a position']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('recognizes a Vitest test object a test file builds from an imported one', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'tests/fees.test.ts':
        "import { test as base } from './context';\nconst withBroker = base.extend({ broker: 'paper' });\nconst withVenue = base.extend({ venue: 'NASDAQ' });\nwithBroker('charges the minimum', () => {});\nwithVenue('charges the exchange fee', () => {});\n",
      'tests/context.ts': "export { test } from 'vitest';\n",
    });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.tests.map((test) => test.title)).toEqual(['charges the minimum', 'charges the exchange fee']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('follows each name once, even when used many times', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/portfolio.spec.ts':
        "import { test } from '../fixtures';\ntest.describe('portfolio', () => {});\ntest('a', async () => {});\ntest('b', async () => {});\n",
    });
    expect((await scanProject(root)).diagnostics).toHaveLength(1);
  });

  it('follows each fixtures file once, however many re-exports lead to it', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      ...barrels('fixtures'),
      'fixtures/index.ts': "export * from './layer-0-0';\nexport * from './trading';\n",
      'fixtures/trading.ts':
        "import { test as base } from '@playwright/test';\nexport const test = base.extend({ account: 'paper' });\nexport { expect } from '@playwright/test';\n",
      'tests/portfolio.spec.ts': spec('../fixtures'),
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.title)).toEqual(['shows the buying power']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('follows a Vitest test object extended in a local file', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'tests/fees.test.ts':
        "import { test, describe, tradingTest } from './context';\nimport { it as check } from './context';\ndescribe('fees', () => {\n  test.skip('charges the minimum', ({ broker }) => {});\n  check('rounds up', () => {});\n  tradingTest('charges the exchange fee', () => {});\n});\n",
      'tests/context.ts':
        "import { test as base } from 'vitest';\nexport const test = base.extend({ broker: 'paper' });\nexport const tradingTest = test.extend({ venue: 'NASDAQ' });\nexport { describe, it } from 'vitest';\n",
      'tests/missing.test.ts': "import { it } from './nowhere';\nit.each([1])('never found %s', () => {});\n",
      'tests/other.test.ts': "import { it } from './context-other';\nit('never found', () => {});\n",
      'tests/broken.test.ts': "import { it } from './broken';\nit('never found', () => {});\n",
      'tests/broken.ts': 'export const it = ;\n',
      'tests/relay.test.ts': "import { it } from './relay';\nit('found through the relay', () => {});\n",
      'tests/relay.ts': "export * from './context';\n",
      'tests/quiet.test.ts':
        "import { compile } from './missing-compiler';\nimport { parse } from './broken';\ncompile('<div/>', () => {});\nparse('x', () => {});\n",
      'tests/context-other.ts': "import { test } from 'vitest';\nexport const it = makeTest(test);\n",
    });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.tests.map((test) => [test.fullName, test.state])).toEqual([
      ['fees > charges the minimum', 'skip'],
      ['fees > rounds up', 'active'],
      ['fees > charges the exchange fee', 'active'],
      ['found through the relay', 'active'],
    ]);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "'it' is imported from './broken', which could not be parsed; tests that use it are missing.",
      "'it' is imported from './nowhere', which could not be read; tests that use it are missing.",
      "'it' is imported from './context-other', which does not export a Vitest test object that could be recognized; tests that use it are missing.",
    ]);
  });
});

describe('scan follows helper functions imported from other files', () => {
  const ORDERS_HELPERS = `import { test } from '@playwright/test';

export function validatesQuantity(side: string) {
  test.skip(side === 'short', 'Short sells need a borrow check');
  // TRD-218 short sells need a borrow check first
  test(\`\${side} rejects a zero quantity\`, async ({ page }) => {});
}
`;

  it('records the tests at each call, at the call, with where the helper writes them', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'helpers/orders.ts': ORDERS_HELPERS,
      'tests/orders.spec.ts': `import { test } from '@playwright/test';
import { validatesQuantity } from '../helpers/orders';

test.describe('buy orders', { tag: '@orders' }, () => {
  validatesQuantity('buy');
});
test.describe('short sells', () => {
  validatesQuantity('short');
});
`,
    });
    const inventory = await scanProject(root);
    // The condition is kept as source text, as everywhere, and the state is set on the line of each call.
    expect(
      inventory.tests.map((test) => [test.fullName, test.lineStart, test.condition, test.stateLine, test.tags]),
    ).toEqual([
      ['buy orders > buy rejects a zero quantity', 5, "side === 'short'", 5, ['@orders']],
      ['short sells > short rejects a zero quantity', 8, "side === 'short'", 8, []],
    ]);
    expect(inventory.tests.map((test) => test.declaredAt)).toEqual([
      { relativeFilePath: 'helpers/orders.ts', lineStart: 6, columnStart: 3 },
      { relativeFilePath: 'helpers/orders.ts', lineStart: 6, columnStart: 3 },
    ]);
    expect(inventory.tests[1].comments).toEqual(['TRD-218 short sells need a borrow check first']);
    expect(inventory.tests[0].bodyHash).toBe(inventory.tests[1].bodyHash);
    expect(inventory.tests.every((test) => test.isInFunction && test.relativeFilePath === 'tests/orders.spec.ts')).toBe(
      true,
    );
    expect(inventory.diagnostics).toEqual([]);
  });

  it('finds the helper through barrels, default exports and renamed exports, and in nested helpers', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'fixtures/index.ts':
        "import { test as base } from '@playwright/test';\nexport const test = base.extend({ account: 'paper' });\n",
      'helpers/index.ts':
        "export * from './missing';\nexport * from './orders';\nexport { default as alertTests } from './alerts';\n",
      'helpers/orders.ts': `import { test } from '../fixtures';
import { watchlistTests as listTests } from './watchlist';

function quantityTests(side: string) {
  test(\`\${side} rejects a zero quantity\`, async ({ account }) => {});
}
const orderTests = (side: string) => {
  test.describe(\`\${side} orders\`, () => {
    quantityTests(side);
    listTests(side);
  });
};
export { orderTests as placesOrders };
`,
      'helpers/watchlist.ts':
        "import { test } from '@playwright/test';\nexport const watchlistTests = (side: string) => {\n  test(`adds the ${side} symbol to the watchlist`, async () => {});\n};\n",
      'helpers/alerts.ts':
        "import { test } from '@playwright/test';\nexport default function (symbol: string) {\n  test(`alerts on ${symbol}`, async () => {});\n}\n",
      'helpers/positions.ts': `import { test } from '@playwright/test';
const positionTests = (symbol: string) => {
  function closeTest(reason: string) {
    test(\`closes \${symbol} at \${reason}\`, async () => {});
  }
  closeTest('the stop-loss');
};
export default positionTests;
`,
      'tests/trading.spec.ts': `import { alertTests, placesOrders } from '../helpers';
import positionTests from '../helpers/positions';

placesOrders('buy');
alertTests('AAPL');
positionTests('MSFT');
`,
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => [test.fullName, test.lineStart, test.declaredAt?.relativeFilePath])).toEqual([
      ['buy orders > buy rejects a zero quantity', 4, 'helpers/orders.ts'],
      ['buy orders > adds the buy symbol to the watchlist', 4, 'helpers/watchlist.ts'],
      ['alerts on AAPL', 5, 'helpers/alerts.ts'],
      ['closes MSFT at the stop-loss', 6, 'helpers/positions.ts'],
    ]);
    expect(inventory.suites.map((suite) => [suite.title, suite.lineStart, suite.declaredAt])).toEqual([
      ['buy orders', 4, { relativeFilePath: 'helpers/orders.ts', lineStart: 8, columnStart: 3 }],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('searches each barrel once for a helper, however many re-exports lead to it', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      ...barrels('helpers'),
      'helpers/index.ts': "export * from './layer-0-0';\nexport * from './orders';\n",
      'helpers/orders.ts': ORDERS_HELPERS,
      'tests/orders.spec.ts': `import { test } from '@playwright/test';
import { validatesQuantity } from '../helpers';

test.describe('buy orders', () => {
  validatesQuantity('buy');
});
`,
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.fullName)).toEqual(['buy orders > buy rejects a zero quantity']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reports what goes wrong in a helper at the call that walks it', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'helpers/venues.ts': `import { test } from '../fixtures/missing';
import { test as playwrightTest } from '@playwright/test';
import { VENUE } from './venues-list';

export function venueTests() {
  test('routes to the venue', async () => {});
  playwrightTest.describe(VENUE, () => {
    playwrightTest(VENUE, async () => {});
  });
}
`,
      'tests/routing.spec.ts': "import { venueTests } from '../helpers/venues';\n\nvenueTests();\nvenueTests();\n",
    });
    const inventory = await scanProject(root);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.lineStart])).toEqual([
      ['dynamic-title', 3],
      ['dynamic-title', 3],
      ['unresolved-test-import', 3],
      ['dynamic-title', 4],
      ['dynamic-title', 4],
    ]);
  });

  it('leaves alone imports that are not local functions, and calls from test bodies', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'helpers/orders.ts': `${ORDERS_HELPERS}export const SIDES = ['buy'];
export default 'not a function';
export { SIDES as sides };
export const defaultSide = 'buy';
`,
      'helpers/cycle-a.ts': "export * from './cycle-b';\n",
      'helpers/cycle-b.ts': "export * from './cycle-a';\n",
      'helpers/broken.ts': 'export function = ;\n',
      'tests/orders.spec.ts': `import { test } from '@playwright/test';
import helperDefault, { sides, defaultSide, validatesQuantity } from '../helpers/orders';
import { cycled } from '../helpers/cycle-a';
import { broken } from '../helpers/broken';
import { formatQuote } from '@trading/quotes';

helperDefault();
sides();
defaultSide();
cycled();
broken();
formatQuote();
test('places an order', async () => {
  validatesQuantity('buy');
});
`,
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => test.title)).toEqual(['places an order']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('follows a function to the test object or describe it returns, through barrels and default exports', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'fixtures/index.ts': `import { test as base } from '@playwright/test';
export const test = base.extend({ account: 'paper' });
export function onDesk(desk: string) {
  return desk === 'equities' ? test.describe.serial : test.describe;
}
`,
      'fixtures/broker.ts': `import { test as base } from '@playwright/test';
import { test } from './index';
export default (venue: string) => (venue === 'live' ? test : base);
`,
      'fixtures/all.ts': "export * from './index';\nexport { default as brokerTest } from './broker';\n",
      'tests/desk.spec.ts': `import { brokerTest, onDesk } from '../fixtures/all';
onDesk('equities')('equities desk', () => {
  brokerTest('live')('sends an order', async ({ account }) => {});
  const paperTest = brokerTest('paper');
  paperTest.skip('cancels an order', async ({ account }) => {});
});
`,
    });
    const inventory = await scanProject(root);
    expect(inventory.suites.map((suite) => [suite.title, suite.isSerial])).toEqual([['equities desk', false]]);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.lineStart])).toEqual([
      ['equities desk > sends an order', 'active', 3],
      ['equities desk > cancels an order', 'skip', 5],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('follows a function to the Vitest test function it returns, with what every value has', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'src/shared/node.ts': `import { it } from 'vitest';
export const onNode = (major: number) => {
  if (!process.versions.node) {
    return it.concurrent.skip;
  }
  return Number(process.versions.node.split('.')[0]) < major ? it.concurrent.skip : it.concurrent;
};
`,
      'src/quotes.test.ts': `import { describe } from 'vitest';
import { onNode } from './shared/node';
describe('quotes', () => {
  onNode(22)('reads the order book', () => {});
});
`,
    });
    const inventory = await scan({ root, patterns: ['src/*.test.ts'], framework: 'vitest' });
    expect(onlyTest(inventory)).toMatchObject({ fullName: 'quotes > reads the order book', isParallel: true });
    expect(inventory.diagnostics).toEqual([]);
  });

  it('follows helpers in Vitest suites too, and not without a reader in scanSource', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'src/shared/fee-tests.ts':
        "import { it } from 'vitest';\nexport function feeTests(venue: string) {\n  it(`charges the ${venue} fee`, () => {});\n}\n",
      'src/fees.test.ts':
        "import { describe } from 'vitest';\nimport { feeTests } from './shared/fee-tests';\ndescribe('fees', () => feeTests('NASDAQ'));\n",
    });
    const inventory = await scan({ root, patterns: ['src/*.test.ts'], framework: 'vitest' });
    expect(onlyTest(inventory)).toMatchObject({
      fullName: 'fees > charges the NASDAQ fee',
      lineStart: 3,
      declaredAt: { relativeFilePath: 'src/shared/fee-tests.ts', lineStart: 3, columnStart: 3 },
    });
    const source = scanSource({
      code: "import { describe } from 'vitest';\nimport { feeTests } from './shared/fee-tests';\ndescribe('fees', () => feeTests('NASDAQ'));\n",
      relativeFilePath: 'src/fees.test.ts',
      framework: 'vitest',
    });
    expect(source.tests).toEqual([]);
  });
});

describe('scan on every operating system', () => {
  const desk = "test.describe('Zürich desk', () => {\n  test('fills a CHF order', async () => {});\n});\n";

  it('reads paths with spaces and letters outside ASCII, a byte order mark and Windows line endings', async () => {
    const plain = await scanProject(
      project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/trading desk/zürich orders.spec.ts': SPEC + desk }),
    );
    const windows = await scanProject(
      project({
        'package.json': PLAYWRIGHT_PACKAGE,
        'tests/trading desk/zürich orders.spec.ts': `﻿${SPEC}${desk}`.replaceAll('\n', '\r\n'),
      }),
    );
    expect(
      windows.tests.map((test) => [test.relativeFilePath, test.fileName, test.lineStart, test.columnStart]),
    ).toEqual([
      ['tests/trading desk/zürich orders.spec.ts', 'zürich orders.spec.ts', 2, 1],
      ['tests/trading desk/zürich orders.spec.ts', 'zürich orders.spec.ts', 4, 3],
    ]);
    expect(windows.tests).toEqual(plain.tests);
    expect(windows.suites).toEqual(plain.suites);
  });

  it('reads \\ in a pattern as an escape outside Windows', async () => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/[legacy]/fills.spec.ts': SPEC });
    const found = await findFiles(root, ['tests/\\[legacy\\]/*.spec.ts'], [], 'playwright', 'linux');
    expect(found.files.map((file) => file.relativeFilePath)).toEqual(['tests/[legacy]/fills.spec.ts']);
  });

  it('reads \\ in a pattern as a separator on Windows', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/orders/fills.spec.ts': SPEC,
      'tests/legacy/fills.spec.ts': SPEC,
    });
    const found = await findFiles(root, ['tests\\**\\*.spec.ts'], ['tests\\legacy\\**'], 'playwright', 'win32');
    expect(found.files.map((file) => file.relativeFilePath)).toEqual(['tests/orders/fills.spec.ts']);
  });

  it.each([
    ['win32', 'tests\\orders\\**\\*.spec.ts', 'tests/orders/**/*.spec.ts'],
    ['linux', 'tests/\\[legacy\\]/*.spec.ts', 'tests/\\[legacy\\]/*.spec.ts'],
    ['darwin', 'tests/\\[legacy\\]/*.spec.ts', 'tests/\\[legacy\\]/*.spec.ts'],
  ] as const)('normalizes patterns for %s', (platform, pattern, normalized) => {
    expect(normalizePattern(pattern, platform)).toBe(normalized);
  });
});

describe('scan and symbolic links', () => {
  it('leaves out linked files for Playwright with a warning, and reads them once for Vitest', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/orders.spec.ts': SPEC,
      'shared/alerts.spec.ts': SPEC,
      'tests/orders.test.ts': "import { test } from 'vitest';\ntest('fills', () => {});\n",
    });
    symlinkSync(path.join(root, 'shared/alerts.spec.ts'), path.join(root, 'tests/alerts.spec.ts'));
    symlinkSync(path.join(root, 'tests/orders.test.ts'), path.join(root, 'tests/orders-copy.test.ts'));
    symlinkSync(path.join(root, 'tests/orders.test.ts'), path.join(root, 'tests/z-orders.test.ts'));
    const playwright = await scanProject(root);
    expect(playwright.tests.map((test) => test.relativeFilePath)).toEqual(['tests/orders.spec.ts']);
    expect(playwright.diagnostics).toMatchObject([
      { code: 'symlink-ignored', level: 'warning', relativeFilePath: 'tests/alerts.spec.ts', lineStart: null },
    ]);
    const vitest = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest', frameworkVersion: '5.0.3' });
    // Read once, from the file's own path, though the link sorts first.
    expect(vitest.tests.map((test) => test.relativeFilePath)).toEqual(['tests/orders.test.ts']);
  });
});

describe('scan reads the framework version', () => {
  it.each([
    ['the installed package', { 'node_modules/@playwright/test/package.json': '{"version":"1.57.0"}' }, '1.57.0'],
    [
      'package-lock.json',
      { 'package-lock.json': JSON.stringify({ packages: { 'node_modules/@playwright/test': { version: '1.50.1' } } }) },
      '1.50.1',
    ],
    [
      'an old package-lock.json',
      { 'package-lock.json': JSON.stringify({ dependencies: { '@playwright/test': { version: '1.49.0' } } }) },
      '1.49.0',
    ],
    [
      'pnpm-lock.yaml',
      { 'pnpm-lock.yaml': "packages:\n\n  '@playwright/test@1.60.0':\n    resolution: {}\n" },
      '1.60.0',
    ],
    ['yarn.lock', { 'yarn.lock': '"@playwright/test@npm:^1.42.0":\n  version: 1.42.1\n' }, '1.42.1'],
    ['a classic yarn.lock', { 'yarn.lock': '"@playwright/test@^1.43.0":\n  version "1.43.1"\n' }, '1.43.1'],
    [
      'the range in package.json',
      { 'package.json': JSON.stringify({ peerDependencies: { '@playwright/test': '>=1.45' } }) },
      '1.45',
    ],
  ])('from %s', async (_, files, version) => {
    const root = project({ 'tests/a.spec.ts': SPEC, ...files });
    expect((await scanProject(root)).frameworkVersion).toBe(version);
  });

  it.each([
    [
      'bun.lock',
      { 'bun.lock': '{\n  "packages": {\n    "@playwright/test": ["@playwright/test@1.61.2", "", {}],\n  }\n}\n' },
      '1.61.2',
    ],
    [
      'yarn.lock with Windows line endings',
      { 'yarn.lock': '"@playwright/test@^1.43.0":\r\n  version "1.43.1"\r\n' },
      '1.43.1',
    ],
  ])('from %s', async (_, files, version) => {
    const root = project({ 'tests/a.spec.ts': SPEC, ...files });
    expect((await scanProject(root)).frameworkVersion).toBe(version);
  });

  it('from a lockfile or package.json in a folder above the root, as in a monorepo', async () => {
    const locked = project({
      'pnpm-lock.yaml': "packages:\n\n  '@playwright/test@1.60.0':\n    resolution: {}\n",
      'apps/web/package.json': JSON.stringify({ devDependencies: { '@playwright/test': 'catalog:' } }),
      'apps/web/tests/a.spec.ts': SPEC,
    });
    const inventory = await scanProject(path.join(locked, 'apps/web'));
    expect(inventory.frameworkVersion).toBe('1.60.0');
    expect(inventory.diagnostics).toEqual([]);
    const declared = project({
      'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '=1.63.0' } }),
      'apps/web/tests/a.spec.ts': SPEC,
    });
    expect((await scanProject(path.join(declared, 'apps/web'))).frameworkVersion).toBe('1.63.0');
  });

  it('applies the newest rules of the major when only a range is known, with a warning', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '^1.50.0' } }),
      'tests/a.spec.ts':
        "import { test } from '@playwright/test';\ntest('edits the settings', { lock: 'user-settings' }, async () => {});\n",
    });
    const inventory = await scanProject(root);
    expect(inventory.frameworkVersion).toBe('1.50.0');
    // `lock` came in Playwright 1.63, so it is read only with the newest rules of 1.x.
    expect(onlyTest(inventory).locks).toEqual(['user-settings']);
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'approximate-framework-version',
        level: 'warning',
        relativeFilePath: 'package.json',
        message: 'Only the range "^1.50.0" was found for Playwright, so the rules of the newest 1.x release apply.',
      },
    ]);
  });

  it('treats a range that starts below the oldest supported version as approximate, when its major is supported', async () => {
    const supported = project({
      'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '^1.40.0' } }),
      'tests/a.spec.ts': SPEC,
    });
    expect((await scanProject(supported)).diagnostics).toMatchObject([
      {
        code: 'approximate-framework-version',
        message: 'Only the range "^1.40.0" was found for Playwright, so the rules of the newest 1.x release apply.',
      },
    ]);
    const old = project({
      'package.json': JSON.stringify({ devDependencies: { vitest: '^2.1.0' } }),
      'tests/fees.test.ts': "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n",
    });
    const inventory = await scanProject(old, { patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'unsupported-framework-version',
        message: 'Vitest 2.1.0 is older than 3.0, the oldest supported version; the results follow 3.0.',
      },
    ]);
  });

  it('from node_modules in a folder above the root, as in a monorepo', async () => {
    const root = project({
      'node_modules/@playwright/test/package.json': '{"version":"1.63.0"}',
      'apps/web/tests/a.spec.ts': SPEC,
    });
    expect((await scanProject(path.join(root, 'apps/web'))).frameworkVersion).toBe('1.63.0');
  });

  it('prefers the version given as an option', async () => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/a.spec.ts': SPEC });
    expect((await scanProject(root, { frameworkVersion: 'v1.50.0' })).frameworkVersion).toBe('1.50.0');
  });

  it('warns when the version is unknown and applies the newest rules', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { '@playwright/test': 'latest' } }),
      'package-lock.json': '{ broken',
      'tests/a.spec.ts':
        "import { test } from '@playwright/test';\ntest.fail.only('exports trades', async () => {});\n",
    });
    const inventory = await scanProject(root);
    expect(inventory.frameworkVersion).toBeNull();
    expect(inventory.diagnostics).toMatchObject([
      { code: 'unknown-framework-version', level: 'warning', relativeFilePath: 'package.json', lineStart: null },
    ]);
    expect(inventory.tests).toHaveLength(1);
  });

  it('warns about a version older than the oldest supported one, where it was read', async () => {
    const root = project({ 'node_modules/vitest/package.json': '{"version":"2.1.9"}', 'tests/a.test.ts': '' });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.relativeFilePath, diagnostic.message])).toEqual([
      [
        'node_modules/vitest/package.json',
        'Vitest 2.1.9 is older than 3.0, the oldest supported version; the results follow 3.0.',
      ],
    ]);
    const given = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest', frameworkVersion: '2.0.0' });
    expect(given.diagnostics.map((diagnostic) => diagnostic.relativeFilePath)).toEqual(['.']);
    const current = project({ 'node_modules/vitest/package.json': '{"version":"3.0.0"}', 'tests/a.test.ts': '' });
    expect((await scan({ root: current, patterns: ['tests/*.test.ts'], framework: 'vitest' })).diagnostics).toEqual([]);
  });
});

describe('scan checks that Vitest globals are turned on', () => {
  const GLOBAL_TEST = "describe('fees', () => {\n  it('charges the minimum', () => {});\n});\n";

  it('warns once when a file uses globals and no config turns them on', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': "export default { test: { globals: false, environment: 'node' } };\n",
      'tsconfig.json': '{ "compilerOptions": { "types": ["node"] } }',
      'tests/a.test.ts': GLOBAL_TEST,
      'tests/b.test.ts': GLOBAL_TEST,
    });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.tests).toHaveLength(2);
    expect(inventory.diagnostics).toMatchObject([{ code: 'globals-not-enabled', relativeFilePath: 'tests/a.test.ts' }]);
  });

  it('reads the config of each package in a monorepo, up to the root', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'packages/orders/vitest.config.ts': 'export default defineConfig({ test: { globals: true } });\n',
      'packages/orders/src/fees.test.ts': GLOBAL_TEST,
      'packages/orders/src/routing.test.ts': GLOBAL_TEST,
      'packages/quotes/src/feed.test.ts': GLOBAL_TEST,
    });
    const inventory = await scan({ root, patterns: ['packages/*/src/*.test.ts'], framework: 'vitest' });
    expect(inventory.diagnostics).toMatchObject([
      { code: 'globals-not-enabled', relativeFilePath: 'packages/quotes/src/feed.test.ts' },
    ]);
  });

  it('stops at the top of the file system for a file outside the root', async () => {
    const workspace = project({ 'app/package.json': VITEST_PACKAGE, 'shared/fees.test.ts': GLOBAL_TEST });
    const root = path.join(workspace, 'app');
    const inventory = await scan({ root, patterns: ['../shared/*.test.ts'], framework: 'vitest' });
    expect(inventory.diagnostics).toMatchObject([
      { code: 'globals-not-enabled', relativeFilePath: '../shared/fees.test.ts' },
    ]);
  });

  it.each([
    ['vitest.config.ts', 'export default defineConfig({ test: { globals: true } });\n'],
    ['vite.config.mjs', "export default { test: { 'globals': true } };\n"],
    ['tsconfig.json', '{ "compilerOptions": { "types": ["vitest/globals"] } }'],
    ['tsconfig.test.json', '{ "compilerOptions": { "types": ["vitest/globals", "node"] } }'],
  ])('accepts globals turned on in %s', async (name, content) => {
    const root = project({ 'package.json': VITEST_PACKAGE, [name]: content, 'tests/a.test.ts': GLOBAL_TEST });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.diagnostics).toEqual([]);
  });
});

describe('scan options', () => {
  it.each([
    [null, 'options must be an object.'],
    [[], 'options must be an object.'],
    [{ framework: 'playwright' }, 'options.patterns must be a non-empty array of glob patterns.'],
    [{ patterns: [], framework: 'playwright' }, 'options.patterns must be a non-empty array of glob patterns.'],
    [{ patterns: [''], framework: 'playwright' }, 'options.patterns must be a non-empty array of glob patterns.'],
    [{ patterns: ['tests'], framework: 'jest' }, 'options.framework must be "playwright" or "vitest".'],
    [
      { patterns: ['tests'], framework: 'vitest', ignore: 'node_modules' },
      'options.ignore must be an array of glob patterns.',
    ],
    [
      { patterns: ['tests'], framework: 'vitest', comments: 'some' },
      'options.comments must be "all", "non-active" or "none".',
    ],
    [
      { patterns: ['tests'], framework: 'vitest', frameworkVersion: 'latest' },
      'options.frameworkVersion must be a version such as "1.63.0".',
    ],
    [
      { patterns: ['tests'], framework: 'vitest', frameworkVersion: 5 },
      'options.frameworkVersion must be a version such as "1.63.0".',
    ],
    [{ patterns: ['tests'], framework: 'vitest', root: '' }, 'options.root must be a non-empty string.'],
  ])('rejects %j', async (options, message) => {
    await expect(scan(options as unknown as ScanOptions)).rejects.toThrow(new TypeError(message));
  });

  it('rejects a root that is not a directory', async () => {
    const root = project({ 'package.json': '{}' });
    await expect(scan({ root: path.join(root, 'package.json'), patterns: ['x'], framework: 'vitest' })).rejects.toThrow(
      TypeError,
    );
    await expect(scan({ root: path.join(root, 'missing'), patterns: ['x'], framework: 'vitest' })).rejects.toThrow(
      /^options\.root must be a directory, and .* is not one\.$/,
    );
  });
});

describe('scanSource options', () => {
  it.each([
    [{ code: 1, relativeFilePath: 'a.spec.ts', framework: 'playwright' }, 'options.code must be a string.'],
    [
      { code: '', relativeFilePath: '', framework: 'playwright' },
      'options.relativeFilePath must be a non-empty string.',
    ],
    [
      { code: '', relativeFilePath: 'a.spec.ts', framework: 'cypress' },
      'options.framework must be "playwright" or "vitest".',
    ],
  ])('rejects %j', (options, message) => {
    expect(() => scanSource(options as never)).toThrow(new TypeError(message));
  });

  it('writes paths with / and without ./, and keeps the version given', () => {
    const inventory = scanSource({
      code: "import { test } from 'vitest';\ntest('fills', () => {});",
      relativeFilePath: '.\\tests\\orders\\fills.test.ts',
      framework: 'vitest',
      frameworkVersion: '4.1.0',
    });
    expect(inventory.tests[0]).toMatchObject({
      relativeFilePath: 'tests/orders/fills.test.ts',
      fileName: 'fills.test.ts',
    });
    expect(inventory.frameworkVersion).toBe('4.1.0');
  });

  it.each(['5.0.3', 'v1.63.0', '4.1', '5.0.0-beta.2', '1.64.0-alpha-2026-10-01.1+build.7'])(
    'accepts the version %s',
    (frameworkVersion) => {
      const inventory = scanSource({ code: '', relativeFilePath: 'a.test.ts', framework: 'vitest', frameworkVersion });
      expect(inventory.frameworkVersion).toBe(frameworkVersion.replace(/^v/, ''));
    },
  );

  it('rejects a long invalid version quickly', () => {
    const started = performance.now();
    const frameworkVersion = `1.2${'-a'.repeat(5_000)}!`;
    expect(() =>
      scanSource({ code: '', relativeFilePath: 'a.test.ts', framework: 'vitest', frameworkVersion }),
    ).toThrow(TypeError);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('scanFile', () => {
  it('turns an unexpected failure into an internal-error diagnostic for that file', () => {
    const result = scanFile("import { test } from '../fixtures';\ntest('fills', async () => {});", 'tests/a.spec.ts', {
      framework: 'playwright',
      version: null,
      comments: 'non-active',
      readModule: () => {
        throw new Error('disk on fire at /home/dana/trading-web/fixtures/index.ts');
      },
      root: '/home/dana/trading-web',
    });
    // The root is left out, so that the output has no absolute paths.
    expect(result.diagnostics).toEqual([
      {
        code: 'internal-error',
        level: 'error',
        message: 'Reading the file failed unexpectedly: disk on fire at ./fixtures/index.ts',
        relativeFilePath: 'tests/a.spec.ts',
        lineStart: null,
        columnStart: null,
        testId: null,
        source: null,
      },
    ]);
  });

  it('reports a thrown value that is not an Error', () => {
    const result = scanFile("import { test } from '../fixtures';\ntest('fills', async () => {});", 'tests/a.spec.ts', {
      framework: 'playwright',
      version: null,
      comments: 'non-active',
      readModule: () => {
        // A thrown value need not be an Error; the scan reports both kinds.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'no permission';
      },
      root: null,
    });
    expect(result.diagnostics[0].message).toBe('Reading the file failed unexpectedly: no permission');
  });
});

describe('scan and links that point nowhere', () => {
  it('reports a test file that is a link to a missing file, and ignores other broken links', async () => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts': SPEC });
    symlinkSync(path.join(root, 'shared/moved.spec.ts'), path.join(root, 'tests/alerts.spec.ts'));
    symlinkSync(path.join(root, 'shared/notes.md'), path.join(root, 'tests/notes.md'));
    const inventory = await scanProject(root, { patterns: ['tests/*'] });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.relativeFilePath, diagnostic.message])).toEqual([
      [
        'tests/alerts.spec.ts',
        'The file is a symbolic link to a file that could not be read: it does not exist (ENOENT).',
      ],
    ]);
  });
});
