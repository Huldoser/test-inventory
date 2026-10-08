import { describe, expect, it } from 'vitest';
import { codes, onlyTest, PLAYWRIGHT_IMPORT, scanPlaywright, testNamed, titles } from './helpers.ts';

describe('Playwright imports', () => {
  it('recognizes test imported by name', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('places a market order', async ({ page }) => {});`);
    expect(titles(inventory)).toEqual(['places a market order']);
  });

  it('recognizes test renamed on import', () => {
    const inventory = scanPlaywright(`
import { test as base } from '@playwright/test';
base('opens the order ticket', async ({ page }) => {});
`);
    expect(titles(inventory)).toEqual(['opens the order ticket']);
  });

  it('recognizes the default export, which is test', () => {
    const inventory = scanPlaywright(`
import pwTest from '@playwright/test';
pwTest.describe('watchlist', () => {
  pwTest('adds a symbol', async () => {});
});
`);
    expect(inventory.tests[0].fullName).toBe('watchlist > adds a symbol');
  });

  it('recognizes test on a namespace import', () => {
    const inventory = scanPlaywright(`
import * as pw from '@playwright/test';
pw.test.describe('portfolio', () => {
  pw.test('shows the total value', async () => {});
});
`);
    expect(inventory.tests[0].fullName).toBe('portfolio > shows the total value');
  });

  it('recognizes test from require, destructured, renamed or as the module', () => {
    const inventory = scanPlaywright(`
const { test, test: it } = require('@playwright/test');
import * as namespace from '@playwright/test';
const pw = require('@playwright/test');
const playwright = pw;
const alias = namespace;
test('logs in', async () => {});
it('logs out', async () => {});
pw.test('resets the password', async () => {});
pw('changes the password', async () => {});
playwright.test('unlocks the account', async () => {});
playwright('opens the account', async () => {});
alias.test('closes the account', async () => {});
require('@playwright/test').test('locks the account', async () => {});
`);
    expect(titles(inventory)).toEqual([
      'logs in',
      'logs out',
      'resets the password',
      'changes the password',
      'unlocks the account',
      'opens the account',
      'closes the account',
      'locks the account',
    ]);
  });

  it('ignores other properties of a required module and nested patterns', () => {
    const inventory = scanPlaywright(`
const { expect, test: { describe }, ...rest } = require('@playwright/test');
describe('orders', () => {});
`);
    expect(inventory.suites).toEqual([]);
  });

  it('recognizes playwright/test and component testing packages', () => {
    const inventory = scanPlaywright(`
import { test } from 'playwright/test';
import { test as ct } from '@playwright/experimental-ct-react';
test('renders the chart', async () => {});
ct('renders the order form', async ({ mount }) => {});
`);
    expect(titles(inventory)).toEqual(['renders the chart', 'renders the order form']);
  });

  it('ignores type-only imports and functions that only share the name', () => {
    const inventory = scanPlaywright(`
import type { test } from '@playwright/test';
import { mergeTests } from '@playwright/test';
const { helper } = require('./helpers');
function check(name, fn) {}
check('not a test', () => {});
mergeTests;
`);
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reports a file that imports Vitest or Jest', () => {
    const inventory = scanPlaywright(`
import { test } from 'vitest';
import { jest } from '@jest/globals';
test('computes fees', () => {});
`);
    expect(codes(inventory)).toEqual(['framework-mismatch', 'framework-mismatch']);
    expect(inventory.diagnostics[0]).toMatchObject({ level: 'error', lineStart: 2, columnStart: 1 });
    expect(inventory.tests).toEqual([]);
  });

  it('reports a test object from a local file, which scanSource cannot read', () => {
    const inventory = scanPlaywright(`
import { test, expect } from '../fixtures';
import { formatPrice } from '../helpers/format';
test('shows the buying power', async ({ portfolioPage }) => {
  await expect(portfolioPage.cashBalance).toHaveText(formatPrice(25_000));
});
test.describe('orders', () => {});
`);
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'unresolved-test-import',
        level: 'error',
        message: "'test' is imported from '../fixtures', which could not be read; tests that use it are missing.",
        lineStart: 2,
        columnStart: 10,
      },
    ]);
    expect(inventory.tests).toEqual([]);
  });
});

describe('Playwright test objects derived with extend and mergeTests', () => {
  it('follows extend, chained extends and mergeTests', () => {
    const inventory = scanPlaywright(`
import { test as base, mergeTests } from '@playwright/test';
import * as pw from '@playwright/test';
const withAccount = base.extend({ account: async ({}, use) => use({ id: 'acc-1' }) });
export const test = mergeTests(withAccount, withMarketData);
const withMarketData = base.extend({ quotes: [] }).extend({ candles: [] });
const viaNamespace = pw.mergeTests(test, pw.test.extend({ region: 'eu' }));
test('trades with an account', async ({ account }) => {});
withMarketData('reads quotes', async ({ quotes }) => {});
viaNamespace('combines fixtures', async () => {});
base.extend({ broker: 'paper' }).describe('paper trading', () => {
  base('fills instantly', async () => {});
});
`);
    expect(titles(inventory)).toEqual([
      'trades with an account',
      'reads quotes',
      'combines fixtures',
      'fills instantly',
    ]);
    expect(inventory.suites.map((suite) => suite.title)).toEqual(['paper trading']);
  });

  it('treats calls that derive or configure test objects as neither tests nor errors', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.extend({ market: 'NASDAQ' });
test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });
test.slow();
test.setTimeout(120_000);
test('waits for the close', async () => {
  test.slow();
  await test.step('opens the session', async () => {});
  test.expect(1).toBe(1);
  test.expect.soft(2).toBe(2);
  test.info().attach('screenshot', { body: Buffer.from('') });
});
`);
    expect(titles(inventory)).toEqual(['waits for the close']);
    expect(inventory.diagnostics).toEqual([]);
  });
});

describe('Playwright declarations', () => {
  it('reads a test with details between the title and the body', () => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('rejects an order above buying power', {
  tag: ['@risk', '@orders'],
  annotation: [
    { type: 'issue', description: 'TRD-104' },
    { type: 'flaky' },
  ],
}, async ({ orderTicket }) => {});
`),
    );
    expect(test.tags).toEqual(['@risk', '@orders']);
    expect(test.annotations).toEqual([
      { type: 'issue', description: 'TRD-104', lineStart: 5 },
      { type: 'flaky', description: null, lineStart: 6 },
    ]);
  });

  it.each([
    ['test.only', { state: 'active', isOnly: true }],
    ['test.skip', { state: 'skip', isSkipped: true, stateSource: 'test', stateLine: 2 }],
    ['test.fixme', { state: 'fixme', isFixme: true, stateSource: 'test' }],
    ['test.fail', { state: 'expectedToFail', isExpectedToFail: true, stateSource: 'test' }],
    ['test.fail.only', { state: 'expectedToFail', isOnly: true }],
  ])('reads %s as a declaration', (callee, expected) => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
${callee}('shows the P&L', async ({ page }) => {});`),
    );
    expect(test).toMatchObject({ ...expected, isConditional: false, condition: null });
  });

  it('reports test.fail.only before Playwright 1.49', () => {
    const inventory = scanPlaywright(
      `${PLAYWRIGHT_IMPORT}
test.fail.only('exports trades', async () => {});`,
      {
        frameworkVersion: '1.48.2',
      },
    );
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics).toMatchObject([
      { code: 'invalid-chain', message: 'test.fail.only needs Playwright 1.49 or newer.', source: 'test.fail.only' },
    ]);
  });

  it('reports a test without a body, which fails the whole file in Playwright', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('shows the order history');
test.only();
`);
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'test() has no test body, so Playwright fails to load the file.',
      'test.only() has no test body, so Playwright fails to load the file.',
    ]);
  });

  it('reads test.skip with only a title as a condition that skips the whole scope', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('margin', () => {
  test.skip('margin calls are not built yet');
  test('shows the margin requirement', async () => {});
});
`);
    expect(onlyTest(inventory)).toMatchObject({ state: 'skip', stateSource: 'suite', isConditional: false });
    expect(inventory.diagnostics).toMatchObject([{ code: 'skip-without-body', level: 'warning', lineStart: 3 }]);
  });

  it('reports chains that are not part of the API', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.only.skip('places a stop order', async () => {});
test.describe.skip.only('alerts', () => {});
test.skip(true).only('closes a position', async () => {});
test.retry('retries a fill', async () => {});
test.step.skip('opens the ticket', async () => {});
test.abort('market closed');
`);
    expect(inventory.tests).toEqual([]);
    expect(codes(inventory)).toEqual(['invalid-chain', 'invalid-chain', 'invalid-chain', 'invalid-chain']);
  });

  it('reports step.skip before 1.50 and abort before 1.60', () => {
    const inventory = scanPlaywright(
      `${PLAYWRIGHT_IMPORT}
test('fills an order', async () => {
  await test.step.skip('confirms the order', async () => {});
  test.abort('broker is down');
});
`,
      { frameworkVersion: '1.49.0' },
    );
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'test.step.skip needs Playwright 1.50 or newer.',
      'test.abort needs Playwright 1.60 or newer.',
    ]);
  });

  it('keeps tags in the title, removes them for titleWithoutTags and lists them first', () => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('orders @orders', { tag: '@regression' }, () => {
  test('fills a market order @smoke  @fast', { tag: '@risk' }, async () => {});
});
`),
    );
    expect(test).toMatchObject({
      title: 'fills a market order @smoke  @fast',
      titleWithoutTags: 'fills a market order',
      suitePath: ['orders @orders'],
      tags: ['@orders', '@regression', '@smoke', '@fast', '@risk'],
    });
  });

  it('reports a tag without @, which Playwright rejects, and keeps the valid ones', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('cancels an order', { tag: ['@orders', 'smoke'] }, async () => {});
`);
    expect(onlyTest(inventory).tags).toEqual(['@orders']);
    expect(inventory.diagnostics).toMatchObject([{ code: 'tag-without-at', level: 'error', source: 'smoke' }]);
  });

  it('resolves tags and annotations from constants in the same file', () => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
const TAGS = { smoke: '@smoke', risk: '@risk' } as const;
const ISSUE = { type: 'issue', description: 'TRD-' + 512 };
const DETAILS = { tag: [TAGS.smoke, \`\${TAGS.risk}\`], annotation: ISSUE };
test('blocks a trade over the daily loss limit', DETAILS, async () => {});
`),
    );
    expect(test.tags).toEqual(['@smoke', '@risk']);
    expect(test.annotations).toEqual([{ type: 'issue', description: 'TRD-512', lineStart: 5 }]);
  });

  it('warns about tags and annotations that cannot be worked out, and keeps the rest', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { TAGS, ISSUES } from './tags';
test('sends a fill notification', {
  tag: ['@orders', TAGS.notifications, process.env.EXTRA_TAG, ...TAGS.all],
  annotation: [ISSUES.notifications, { type: 7 }, ...ISSUES.all, null],
}, async () => {});
test('marks the order as filled', { tag: TAGS.orders, annotation: ISSUES.fills }, async () => {});
`);
    expect(testNamed(inventory, 'sends a fill notification').tags).toEqual(['@orders']);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.source, diagnostic.message])).toEqual(
      [
        [
          'unresolved-tag',
          'TAGS.notifications',
          "Tag value TAGS.notifications comes from './tags' and could not be worked out; the tag is missing.",
        ],
        [
          'unresolved-tag',
          'process.env.EXTRA_TAG',
          'Tag value process.env.EXTRA_TAG could not be worked out; the tag is missing.',
        ],
        [
          'unresolved-tag',
          'TAGS.all',
          "Tag value TAGS.all comes from './tags' and could not be worked out; the tag is missing.",
        ],
        [
          'unresolved-annotation',
          'ISSUES.notifications',
          "Annotation ISSUES.notifications comes from './tags' and could not be worked out; it is missing.",
        ],
        ['unresolved-annotation', '{ type: 7 }', 'Annotation { type: 7 } could not be worked out; it is missing.'],
        ['unresolved-annotation', 'null', 'Annotation null could not be worked out; it is missing.'],
        [
          'unresolved-tag',
          'TAGS.orders',
          "Tag value TAGS.orders comes from './tags' and could not be worked out; the tag is missing.",
        ],
        [
          'unresolved-annotation',
          'ISSUES.fills',
          "Annotation ISSUES.fills comes from './tags' and could not be worked out; it is missing.",
        ],
      ],
    );
  });

  it('reads details spread from other objects', () => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { SHARED } from './details';
const BASE = { tag: '@orders', annotation: { type: 'owner', description: 'trading' } };
test('fills a stop order', { ...BASE, ...SHARED, ['lock']: 'broker', 'tag': ['@orders', '@stops'] }, async () => {});
`),
    );
    expect(test).toMatchObject({ tags: ['@orders', '@stops'], annotations: [{ type: 'owner' }], locks: ['broker'] });
  });

  it('ignores calls on test with a computed or private member', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
const method = 'skip';
test[method]('fills', async () => {});
class Suite { #test = test; run() { this.#test.only('fills', async () => {}); } }
`);
    expect(inventory.tests).toEqual([]);
  });

  it('reports details that are not an object, or come from an import', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { DETAILS } from './details';
const LEVELS = [10, 20];
const ENABLED = true;
test('shows the order book', DETAILS, async () => {});
test('shows the depth', LEVELS, async () => {});
test('shows the spread', { [ENABLED]: '@quotes', tag: '@smoke' }, async () => {});
`);
    expect(inventory.tests.map((test) => test.tags)).toEqual([[], [], ['@smoke']]);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.source])).toEqual([
      ['unresolved-option', 'DETAILS'],
      ['unresolved-option', 'LEVELS'],
      ['unresolved-option', "[ENABLED]: '@quotes'"],
    ]);
  });

  it('reads locks from Playwright 1.63, inherited from describes', () => {
    const code = `${PLAYWRIGHT_IMPORT}
test.describe('account settings', { lock: 'user-settings' }, () => {
  test('changes the base currency', { lock: ['user-settings', 'fx-rates'] }, async () => {});
});
`;
    expect(onlyTest(scanPlaywright(code)).locks).toEqual(['user-settings', 'fx-rates']);
    expect(scanPlaywright(code).suites[0].locks).toEqual(['user-settings']);
    expect(onlyTest(scanPlaywright(code, { frameworkVersion: '1.62.0' })).locks).toEqual([]);
  });

  it('reads annotations pushed with test.info() in the test body', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('statements', { annotation: { type: 'owner', description: 'reporting team' } }, () => {
  test('downloads the monthly statement', async () => {
    test.info().annotations.push({ type: 'issue', description: 'TRD-618' }, ...extra);
    test.info().annotations.push(ISSUE_FROM_ENV);
  });
});
test.info().annotations.push({ type: 'outside', description: 'not in a test' });
`);
    expect(onlyTest(inventory).annotations).toEqual([
      { type: 'owner', description: 'reporting team', lineStart: 2 },
      { type: 'issue', description: 'TRD-618', lineStart: 4 },
    ]);
    expect(codes(inventory)).toEqual(['unresolved-annotation']);
  });

  it('reads a dynamic title as its source text with a warning', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { SYMBOL } from './symbols';
const venue = 'NASDAQ';
test(\`quotes \${SYMBOL} on \${venue}\`, async () => {});
test(\`lists \${venue}\` + ' symbols', async () => {});
test(...titleAndBody);
`);
    expect(inventory.tests.map((test) => [test.title, test.hasDynamicTitle, test.bodyHash])).toEqual([
      ['`quotes ${SYMBOL} on ${venue}`', true, expect.any(String)],
      ['lists NASDAQ symbols', false, expect.any(String)],
      ['...titleAndBody', true, null],
    ]);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Title `quotes ${SYMBOL} on ${venue}` comes from './symbols' and could not be worked out; the record uses its source text.",
      'Title ...titleAndBody could not be worked out; the record uses its source text.',
    ]);
  });
});

describe('Playwright describes', () => {
  it.each([
    ['test.describe', {}],
    ['test.describe.only', { isOnly: true }],
    ['test.describe.skip', { isSkipped: true }],
    ['test.describe.fixme', { isFixme: true }],
    ['test.describe.serial', { isSerial: true }],
    ['test.describe.serial.only', { isSerial: true, isOnly: true }],
    ['test.describe.parallel', { isParallel: true }],
    ['test.describe.parallel.only', { isParallel: true, isOnly: true }],
  ])('reads %s', (callee, expected) => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
${callee}('alerts', () => {
  test('creates an alert', async () => {});
});`);
    expect(inventory.suites[0]).toMatchObject({
      isOnly: false,
      isSkipped: false,
      isFixme: false,
      isSerial: false,
      isParallel: false,
      ...expected,
    });
  });

  it('leaves an anonymous describe out of paths and titles', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('backtests', () => {
  test.describe(() => {
    test.describe.configure({ mode: 'serial' });
    test('runs the backtest', async () => {});
  });
});
`);
    expect(inventory.suites.map((suite) => [suite.title, suite.path])).toEqual([
      ['backtests', ['backtests']],
      ['', ['backtests']],
    ]);
    expect(onlyTest(inventory)).toMatchObject({
      suitePath: ['backtests'],
      fullName: 'backtests > runs the backtest',
      isSerial: true,
    });
  });

  it('records a describe without a callback and ignores one without arguments', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('short selling');
test.describe();
`);
    expect(inventory.suites).toMatchObject([{ title: 'short selling', bodyHash: null }]);
  });

  it('reports an async describe callback that awaits', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('market data', async () => {
  const symbols = await loadSymbols();
  test('loads quotes', async () => {});
});
test.describe('order book', async () => {
  for await (const level of levels()) {}
});
test.describe('fills', async () => {
  test('streams fills', async () => {
    await waitForFill();
  });
});
`);
    expect(codes(inventory)).toEqual(['async-describe', 'async-describe']);
    expect(inventory.diagnostics[0]).toMatchObject({ lineStart: 2, columnStart: 30 });
  });

  it('applies describe.configure to the describe or the file, the last call winning', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { MODE } from './config';
test.describe.configure({ mode: 'parallel' });
test.describe('order lifecycle', () => {
  test.describe.configure({ mode: 'serial', retries: 1 });
  test('places the order', async () => {});
});
test.describe('reports', () => {
  test.describe.configure({ mode: 'parallel' });
  test.describe.configure({ mode: 'default' });
  test('builds the daily report', async () => {});
});
test.describe('alerts', () => {
  test.describe.configure(MODE);
  test.describe.configure();
  test('creates an alert', async () => {
    test.describe.configure({ mode: 'serial' });
  });
});
`);
    expect(inventory.tests.map((test) => [test.title, test.isParallel, test.isSerial])).toEqual([
      ['places the order', false, true],
      ['builds the daily report', false, false],
      ['creates an alert', true, false],
    ]);
  });
});

describe('Playwright skip, fixme and fail calls', () => {
  it('applies a file-level test.skip() to every test in the file', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.skip();
test('opens the chart', async () => {});
`);
    expect(onlyTest(inventory)).toMatchObject({
      state: 'skip',
      stateSource: 'file',
      stateLine: 2,
      isConditional: false,
    });
  });

  it('applies a describe-level condition and reason to the tests in the describe', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('price stream', () => {
  test.fixme(({ browserName }) => browserName === 'webkit', 'WebSocket reconnects in a loop');
  test('streams quotes', async () => {});
});
`);
    expect(inventory.suites[0]).toMatchObject({
      isFixme: true,
      isConditional: true,
      condition: "browserName === 'webkit'",
      reason: 'WebSocket reconnects in a loop',
    });
    expect(onlyTest(inventory)).toMatchObject({
      state: 'fixme',
      stateSource: 'suite',
      condition: "browserName === 'webkit'",
    });
  });

  it('uses the whole callback as the condition when it has a block body', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.skip(({ isMobile }) => { return isMobile; }, 'The order book needs a wide screen');
test('shows ten price levels', async () => {});
`);
    expect(onlyTest(inventory).condition).toBe('({ isMobile }) => { return isMobile; }');
  });

  it('works out conditions written as constants', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
const PAPER_TRADING = true;
const LIVE = !PAPER_TRADING;
test.describe('live orders', () => {
  test.skip(LIVE, 'Only runs against the live broker');
  test('sends a live order', async () => {});
});
test.describe('paper orders', () => {
  test.fixme(PAPER_TRADING, \`Paper broker is down\`);
  test('fills a paper order', async () => {});
});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.isConditional, test.reason])).toEqual([
      ['sends a live order', 'active', false, null],
      ['fills a paper order', 'fixme', false, 'Paper broker is down'],
    ]);
  });

  it('applies calls in the test body to that test, with the conditions around them', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('trades on the weekend', async ({ browserName, page }) => {
  if (process.env.MARKET_DATA === 'delayed') {
    test.skip(browserName === 'firefox', 'Delayed data never updates on Firefox');
  } else {
    test.fail();
  }
});
`);
    expect(onlyTest(inventory)).toMatchObject({
      state: 'skip',
      isConditional: true,
      condition: "process.env.MARKET_DATA === 'delayed' && browserName === 'firefox'",
      reason: 'Delayed data never updates on Firefox',
      stateSource: 'test',
      stateLine: 4,
    });
  });

  it('records the reason as source text when it cannot be worked out', () => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { REASONS } from './reasons';
test('settles a trade', async () => {
  test.fixme(true, REASONS.settlement);
});
`),
    );
    expect(test).toMatchObject({ state: 'fixme', reason: 'REASONS.settlement', isConditional: false });
  });

  it('applies calls in beforeEach and beforeAll hooks to every test in the scope', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { isMarketClosed } from './market-hours';
test.describe('price alerts', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isMarketClosed(), 'Alerts only trigger while the market is open');
    await page.goto('/alerts');
  });
  test.afterAll(async () => {});
  test('triggers an alert', async () => {});
});
test.beforeAll('opens the session', async () => {
  test.fail(process.env.BROKER === 'paper');
});
`);
    expect(onlyTest(inventory)).toMatchObject({
      state: 'skip',
      condition: 'isMarketClosed()',
      stateSource: 'suite',
    });
  });

  it('ignores a call whose condition is always false', () => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('fills a stop order', async () => {
  test.skip(false, 'never');
  test.fixme(0);
});
`),
    );
    expect(test.state).toBe('active');
  });

  it('joins nested conditions with && and keeps their grouping', () => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('shows margin', async ({ isMobile, browserName }) => {
  if (isMobile || browserName === 'webkit') {
    test.skip(process.env.CI ? true : isMobile, 'narrow layout');
  }
});
`),
    );
    expect(test.condition).toBe("(isMobile || browserName === 'webkit') && (process.env.CI ? true : isMobile)");
  });
});

describe('Playwright nesting', () => {
  it('ignores hooks declared inside a test and hooks without a function', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.beforeEach();
test('places an order', async () => {
  test.beforeEach(async () => {
    test.skip();
  });
});
`);
    expect(onlyTest(inventory).state).toBe('skip');
  });

  it('reports tests and describes declared inside a test or hook and leaves them out', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('places an order', async () => {
  test('confirms the order', async () => {});
});
test.beforeEach(async () => {
  test.describe('cleanup', () => {});
});
`);
    expect(titles(inventory)).toEqual(['places an order']);
    expect(inventory.suites).toEqual([]);
    expect(codes(inventory)).toEqual(['nested-test', 'nested-test']);
  });

  it('marks tests declared in loops, conditions and functions', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
const SYMBOLS = ['AAPL', 'MSFT'];
for (const symbol of SYMBOLS) {
  test(\`quotes \${symbol}\`, async () => {});
}
SYMBOLS.forEach((symbol) => test(\`charts \${symbol}\`, async () => {}));
SYMBOLS.forEach(defineQuoteTest, [1, , 2]);
SYMBOLS.map(function (symbol) {
  test('lists ' + symbol, async () => {});
});
let attempt = 0;
while (attempt++ < 2) test('retries the order', async () => {});
if (process.env.LIVE_BROKER) {
  test('sends a live order', async () => {});
}
process.env.CI && test('runs on CI only', async () => {});
function defineOrderTests(side) {
  test(\`places a \${side} order\`, async () => {});
}
defineOrderTests('buy');
`);
    expect(inventory.tests.map((test) => [test.title, test.isInLoop, test.isInCondition, test.isInFunction])).toEqual([
      ['`quotes ${symbol}`', true, false, false],
      ['`charts ${symbol}`', true, false, false],
      ["'lists ' + symbol", true, false, false],
      ['retries the order', true, false, false],
      ['sends a live order', false, true, false],
      ['runs on CI only', false, true, false],
      ['`places a ${side} order`', false, false, true],
    ]);
    expect(codes(inventory).filter((code) => code === 'test-in-loop')).toHaveLength(4);
  });
});

describe('Playwright forms that are rare but valid', () => {
  it('binds test from string import names, string keys and the module object', () => {
    const inventory = scanPlaywright(`
import { 'test' as base, mergeTests as merge } from '@playwright/test';
import * as pw from '@playwright/test';
import * as fixtures from './fixtures';
const { 'test': quoted, mergeTests, [dynamicKey]: unknown } = require('@playwright/test');
const euTest = pw.test.extend({ region: 'eu' });
const merged = mergeTests(euTest, quoted);
const helpers = { mergeTests: () => {} };
const notMerged = helpers.mergeTests(euTest);
const notExtended = pw.other();
const fromVariable = require(moduleName);
let pending;
base('trades in the US', async () => {});
quoted('trades from a string key', async () => {});
euTest('trades in the EU', async () => {});
merged('trades everywhere', async () => {});
notMerged('is not a test', async () => {});
fixtures.test('is not followed', async () => {});
`);
    expect(titles(inventory)).toEqual([
      'trades in the US',
      'trades from a string key',
      'trades in the EU',
      'trades everywhere',
    ]);
  });

  it('reads a describe with a dynamic title, details passed by spread, and odd tag values', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { AREA } from './areas';
const ISSUES = [{ type: 'issue', description: 'TRD-1' }, { type: 'issue', description: 'TRD-2' }];
test.describe(AREA, () => {
  test('keeps the order', ...DETAILS, async () => {});
  test('lists the issues', { annotation: ISSUES, tag: ['@orders', , '@risk'] }, async () => {});
  test('has a numeric tag', { tag: 42 }, async () => {});
});
`);
    expect(inventory.suites[0]).toMatchObject({ title: 'AREA', hasDynamicTitle: true });
    expect(testNamed(inventory, 'lists the issues')).toMatchObject({
      tags: ['@orders', '@risk'],
      annotations: [
        { type: 'issue', description: 'TRD-1', lineStart: 6 },
        { type: 'issue', description: 'TRD-2', lineStart: 6 },
      ],
    });
    expect(codes(inventory)).toEqual(['dynamic-title', 'unresolved-option', 'unresolved-tag']);
  });

  it('ignores calls through computed members and tags that are not templates', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test[method](timeout)('fills', async () => {});
test.each(cases)\`table\`('fills', async () => {});
tag\`template\`('fills', async () => {});
`);
    expect(inventory.tests).toEqual([]);
  });

  it('reads conditions guarded by ?? and switch cases', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('routes the order', async ({ browserName }) => {
  process.env.BROKER ?? test.skip(true, 'no broker configured');
  switch (process.env.REGION) {
    case 'eu':
      test.fixme(browserName === 'webkit');
      break;
    default:
      test.fail();
  }
});
switch (process.env.SUITE) {
  case 'nightly':
    test('runs the nightly reconciliation', async () => {});
}
test('settles the trade', async () => {
  switch (process.env.CLEARING) {
    default:
      test.fixme();
  }
});
`);
    expect(inventory.tests.map((test) => [test.state, test.condition, test.isInCondition])).toEqual([
      ['skip', '(process.env.BROKER) == null', false],
      ['active', null, true],
      ['fixme', null, false],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('negates the other cases for a switch default', () => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('routes by region', async () => {
  switch (process.env.REGION) {
    case 'eu':
    case 'uk':
      break;
    default:
      test.skip(true, 'only routed in Europe');
  }
});
`),
    );
    expect(test.condition).toBe("process.env.REGION !== 'eu' && process.env.REGION !== 'uk'");
  });
});

describe('Playwright local names', () => {
  it('does not take a local name that shadows test for the test object', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('order history', () => {
  for (const test of loadReport().tests) {
    test.results.push({ status: 'passed' });
  }
  function describeFill(test: { title: string }) {
    return test.title.toUpperCase();
  }
  test('lists filled orders', async () => {});
});
`);
    expect(titles(inventory)).toEqual(['lists filled orders']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('ignores members that every function has, such as constructor', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.constructor('return this')();
test.describe.hasOwnProperty('only');
test('places a limit order', async () => {});
`);
    expect(titles(inventory)).toEqual(['places a limit order']);
    expect(codes(inventory)).toEqual(['invalid-chain', 'invalid-chain']);
  });

  it('follows a test object chosen by a condition', () => {
    const inventory = scanPlaywright(`import { test as base } from '@playwright/test';
const liveTest = base.extend({ broker: 'live' });
const test = process.env.BROKER_URL ? liveTest : base;
const replayTest = process.env.REPLAY_FILE ? replayFrom(process.env.REPLAY_FILE) : base;
test('sends an order to the broker', async ({ page }) => {});
replayTest('replays the opening auction', async ({ page }) => {});
`);
    expect(titles(inventory)).toEqual(['sends an order to the broker', 'replays the opening auction']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads describe functions kept in a variable, also chosen by a condition', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import * as playwright from '@playwright/test';
const serialDescribe = test.describe.serial;
const focusedSerial = serialDescribe.only;
const describeOnPlatform = process.env.PLATFORM ? test.describe.serial : test.describe;
const describeParallel = process.env.PLATFORM ? playwright.test.describe.parallel : test.describe.parallel.only;
const step = test.step;
const configure = test.describe.configure;
const describeOrHelper = process.env.PLATFORM ? test.describe : describeAccount;
serialDescribe('order ticket', () => {
  test('places a market order', async () => {});
});
focusedSerial('position sizing', () => {});
describeOnPlatform('table editor', () => {
  test('sorts rows by symbol', async () => {});
});
describeParallel('watchlists', () => {});
describeOrHelper('not a describe', () => {});
`);
    expect(inventory.suites.map((suite) => [suite.title, suite.isSerial, suite.isParallel, suite.isOnly])).toEqual([
      ['order ticket', true, false, false],
      ['position sizing', true, false, true],
      ['table editor', false, false, false],
      ['watchlists', false, true, false],
    ]);
    expect(inventory.tests.map((test) => test.fullName)).toEqual([
      'order ticket > places a market order',
      'table editor > sorts rows by symbol',
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads calls on a local test object created by a call it cannot follow, with one warning', () => {
    const inventory = scanPlaywright(`import { createBrokerTest } from '../support/broker';
const test = createBrokerTest({ venue: 'NASDAQ' });
test('fills a market order', async ({ page }) => {});
test.skip('fills a stop order', async ({ page }) => {});
const optionsTest = await createBrokerTest({ venue: 'CBOE' });
optionsTest('fills a covered call', checkCoveredCall);
`);
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([
      ['fills a market order', 'active'],
      ['fills a stop order', 'skip'],
      ['fills a covered call', 'active'],
    ]);
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'local-test-object',
        lineStart: 2,
        message:
          "'test' is created by createBrokerTest({ venue: 'NASDAQ' }), which is not followed; calls shaped like tests are read as tests.",
        source: "createBrokerTest({ venue: 'NASDAQ' })",
      },
      { code: 'local-test-object', lineStart: 5 },
    ]);
  });

  it('does not read a local object as a test when its name or calls are not shaped like one', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { expectFill, createFillCheck } from '../support/fills';
const fillTest = createFillCheck();
const check = createFillCheck();
const it = (title: string, run: () => void) => run();
fillTest('AAPL', 100, 'filled', async () => {});
fillTest('AAPL', 100);
fillTest.expect('MSFT');
check('fills a market order', async () => {});
it('is a helper', () => {});
expectFill('AAPL', 100, 'filled', async () => {});
test('shows the fill price', async () => {});
`);
    expect(titles(inventory)).toEqual(['shows the fill price']);
    expect(inventory.diagnostics).toEqual([]);
  });
});

describe('Playwright states set in helper functions', () => {
  it('applies a helper skip only to the tests that call the helper, with the conditions around the call', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
function skipWithoutBroker() {
  test.skip(!process.env.BROKER_URL, 'needs a broker');
}
const skipOnWebkit = (browserName: string) => {
  if (process.env.CI) test.fixme(browserName === 'webkit', 'confirm dialog stays open');
};
function formatPrice(price: number) {
  return price.toFixed(2);
}
function quarantine() {
  test.fixme();
}
test('places an order', async () => {
  skipWithoutBroker();
});
test('shows the portfolio', async () => {
  formatPrice(187.5);
});
test('cancels an order', async ({ browserName }) => {
  if (process.env.REGION === 'eu') skipOnWebkit(browserName);
});
test('exports the order history', async () => {
  quarantine();
});
`);
    expect(
      inventory.tests.map((test) => [test.title, test.state, test.condition, test.reason, test.stateLine]),
    ).toEqual([
      ['places an order', 'skip', '!process.env.BROKER_URL', 'needs a broker', 3],
      ['shows the portfolio', 'active', null, null, null],
      [
        'cancels an order',
        'fixme',
        "process.env.REGION === 'eu' && process.env.CI && browserName === 'webkit'",
        'confirm dialog stays open',
        6,
      ],
      ['exports the order history', 'fixme', null, null, 12],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('applies a helper called in a hook to the tests the hook covers, and one called in a describe to the describe', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
function requireMarketHours() {
  test.skip(isMarketClosed(), 'market is closed');
}
function runInOrder() {
  test.describe.configure({ mode: 'serial' });
}
function failOnAndroid() {
  requireMarketHours();
  test.fail(process.env.DEVICE === 'android');
}
test.describe('alerts', () => {
  test.beforeEach(() => {
    requireMarketHours();
  });
  test('notifies above the price', async () => {});
});
test.describe('order lifecycle', () => {
  runInOrder();
  test('places the order', async () => {});
});
test.describe('fills', () => {
  test('fills on Android', async () => {
    failOnAndroid();
    runInOrder();
  });
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.condition, test.isSerial])).toEqual([
      ['alerts > notifies above the price', 'skip', 'isMarketClosed()', false],
      ['order lifecycle > places the order', 'active', null, true],
      ['fills > fills on Android', 'skip', 'isMarketClosed()', false],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('applies nothing from a helper no test calls or one the file exports, and says so', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
export function skipWithoutBroker() {
  test.skip(!process.env.BROKER_URL, 'needs a broker');
}
const fixmeOnWebkit = () => test.fixme(true);
function unusedConfigure() {
  test.describe.configure({ mode: 'parallel' });
}
function recursive() {
  recursive();
}
export const skipOnLinux = () => test.skip(process.platform === 'linux');
export const [firstHelper] = [() => test.skip()];
export { fixmeOnWebkit };
export { tradingTest } from '../fixtures';
export default function () {
  test.skip();
}
test('places an order', async () => {
  skipWithoutBroker();
  fixmeOnWebkit();
  recursive();
});
`);
    expect(onlyTest(inventory).state).toBe('active');
    expect(
      inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.lineStart, diagnostic.message]),
    ).toEqual([
      [
        'state-in-helper',
        3,
        'test.skip() is in a function that is exported; it applies to the tests that call the function, so it is not applied here.',
      ],
      ['state-in-helper', 5, expect.stringContaining('test.fixme() is in a function that is exported')],
      ['state-in-helper', 7, expect.stringContaining('no test, hook or describe in the file calls')],
      ['state-in-helper', 12, expect.stringContaining('test.skip() is in a function that is exported')],
      ['state-in-helper', 13, expect.stringContaining('no test, hook or describe in the file calls')],
      ['state-in-helper', 17, expect.stringContaining('test.skip() is in a function that is exported')],
    ]);
  });
});

describe('Playwright values that could not be worked out', () => {
  it('reports details, spreads, locks and modes from imports, and keeps what it can read', () => {
    const inventory = scanPlaywright(
      `${PLAYWRIGHT_IMPORT}
import { DETAILS, SHARED, LOCKS, MODE, FIELDS } from './settings';
test('changes the base currency', DETAILS, async () => {});
test('closes a position', { ...SHARED, tag: '@risk', [FIELDS.lock]: 'portfolio' }, async () => {});
test('edits the settings', { lock: [LOCKS.settings, 'fx-rates'] }, async () => {});
test.describe('order lifecycle', () => {
  test.describe.configure(MODE);
  test.describe.configure({ mode: MODE.serial });
  test('places an order', async () => {});
});
`,
      { frameworkVersion: '1.63.0' },
    );
    expect(testNamed(inventory, 'closes a position').tags).toEqual(['@risk']);
    expect(testNamed(inventory, 'edits the settings').locks).toEqual(['fx-rates']);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message])).toEqual([
      [
        'unresolved-option',
        "Options object DETAILS comes from './settings' and could not be worked out; its tags, annotations and locks are missing.",
      ],
      [
        'unresolved-option',
        "Options object SHARED comes from './settings' and could not be worked out; its tags, annotations and locks are missing.",
      ],
      [
        'unresolved-option',
        "Options object [FIELDS.lock]: 'portfolio' comes from './settings' and could not be worked out; its tags, annotations and locks are missing.",
      ],
      [
        'unresolved-option',
        "Option lock: LOCKS.settings comes from './settings' and could not be worked out; the lock is missing.",
      ],
      [
        'unresolved-option',
        "Options object MODE comes from './settings' and could not be worked out; the mode is unknown.",
      ],
      [
        'unresolved-option',
        "Option mode: MODE.serial comes from './settings' and could not be worked out; the mode is unknown.",
      ],
    ]);
  });

  it('keeps the source text of a reason it cannot work out, as for titles', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { REASONS } from './reasons';
test('settles a trade', async () => {
  test.fixme(true, REASONS.settlement);
});
test.describe('margin calls', () => {
  test.skip(true, \`margin desk is closed \${new Date().getDay()}\`);
  test('liquidates', async () => {});
});
`);
    expect(inventory.tests.map((test) => [test.reason, test.hasDynamicReason])).toEqual([
      ['REASONS.settlement', true],
      ['`margin desk is closed ${new Date().getDay()}`', true],
    ]);
    expect(inventory.suites[0]).toMatchObject({
      reason: '`margin desk is closed ${new Date().getDay()}`',
      hasDynamicReason: true,
    });
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message])).toEqual([
      [
        'dynamic-reason',
        "Reason REASONS.settlement comes from './reasons' and could not be worked out; the record uses its source text.",
      ],
      [
        'dynamic-reason',
        'Reason `margin desk is closed ${new Date().getDay()}` could not be worked out; the record uses its source text.',
      ],
    ]);
  });

  it('reads a call through a sequence, as bundlers write it', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
(0, test)('places a limit order', async () => {});
(0, test.describe)('alerts', () => {});
(setup(), test)('is not read', async () => {});
`);
    expect(titles(inventory)).toEqual(['places a limit order']);
    expect(inventory.suites.map((suite) => suite.title)).toEqual(['alerts']);
  });
});
