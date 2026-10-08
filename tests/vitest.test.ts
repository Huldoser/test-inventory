import { describe, expect, it } from 'vitest';
import { codes, onlyTest, scanVitest, testNamed, titles, VITEST_IMPORT } from './helpers.ts';

describe('Vitest imports', () => {
  it('recognizes test, it, describe and suite, also renamed', () => {
    const inventory = scanVitest(`
import { describe as group, it, suite, test as check } from 'vitest';
group('sma', () => {
  it('averages the last 20 closes', () => {});
  check('returns null before 20 closes', () => {});
});
suite('rsi', () => {
  it('stays between 0 and 100', () => {});
});
`);
    expect(inventory.tests.map((test) => test.fullName)).toEqual([
      'sma > averages the last 20 closes',
      'sma > returns null before 20 closes',
      'rsi > stays between 0 and 100',
    ]);
  });

  it('recognizes the namespace import', () => {
    const inventory = scanVitest(`
import * as vt from 'vitest';
vt.describe('fees', () => {
  vt.test('charges the minimum commission', () => {});
  vt.it.skip('adds the exchange fee', () => {});
  vt['test']('charges per share', () => {});
});
vt.expect(1).toBe(1);
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state])).toEqual([
      ['fees > charges the minimum commission', 'active'],
      ['fees > adds the exchange fee', 'skip'],
      ['fees > charges per share', 'active'],
    ]);
  });

  it('reports a default import and require, which Vitest does not support', () => {
    const inventory = scanVitest(`
import vitest from 'vitest';
const { test } = require('vitest');
vitest.test('validates an order', () => {});
`);
    expect(codes(inventory)).toEqual(['invalid-import', 'invalid-import']);
    expect(inventory.tests).toEqual([]);
  });

  it('reports bench imported from vitest in Vitest 5', () => {
    const code = `import { bench, describe } from 'vitest';
describe('sma', () => {
  bench('20-day average over 10 years of closes', () => {});
});`;
    expect(codes(scanVitest(code))).toEqual(['removed-api']);
    expect(codes(scanVitest(code, { frameworkVersion: '4.1.0' }))).toEqual([]);
  });

  it('reports a file that imports Playwright or Jest', () => {
    const inventory = scanVitest(`
import { test } from '@playwright/test';
import { jest } from '@jest/globals';
import type { TestContext } from 'vitest';
test('opens the chart', async () => {});
`);
    expect(codes(inventory)).toEqual(['framework-mismatch', 'framework-mismatch']);
    expect(inventory.tests).toEqual([]);
  });

  it('recognizes in-source tests without counting the import.meta.vitest guard as a condition', () => {
    const inventory = scanVitest(
      `
export function formatPnl(amount: number): string {
  return amount.toFixed(2);
}

if (import.meta.vitest) {
  const { describe, it, beforeEach, expect } = import.meta.vitest;
  describe('formatPnl', () => {
    beforeEach(({ skip }) => {
      skip(process.env.LOCALE !== 'en-US', 'formats for en-US only');
    });
    it('keeps two decimals', () => {
      expect(formatPnl(1.5)).toBe('1.50');
    });
  });
}
`,
      { relativeFilePath: 'src/pnl/format.ts' },
    );
    expect(onlyTest(inventory)).toMatchObject({
      fullName: 'formatPnl > keeps two decimals',
      isInCondition: false,
      state: 'skip',
      condition: "process.env.LOCALE !== 'en-US'",
      stateSource: 'suite',
    });
  });

  it('recognizes globals that are neither imported nor declared', () => {
    const inventory = scanVitest(`
describe('positionSize', () => {
  beforeEach(() => {});
  it('risks 1% of the account', () => {});
});
`);
    expect(onlyTest(inventory).fullName).toBe('positionSize > risks 1% of the account');
  });

  it('keeps reading globals when a nested function declares the same name', () => {
    // The shape of vuejs/core's e2e specs: a component declares `test` inside setup() in a test body.
    const inventory = scanVitest(`
describe('order book', () => {
  it('renders 3,000 price levels', async () => {
    const OrderBook = defineComponent({
      setup() {
        const test = ref([...Array(3000)].map((_, level) => ({ level, size: 100 })));
        return { test };
      },
    });
    mount(OrderBook);
  });

  it('doubles every size', () => {
    expect([100, 250].map((it) => it * 2)).toEqual([200, 500]);
  });

  test('keeps the best bid on top', () => {});
});
`);
    expect(inventory.tests.map((test) => test.fullName)).toEqual([
      'order book > renders 3,000 price levels',
      'order book > doubles every size',
      'order book > keeps the best bid on top',
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('does not take a declared name for a global', () => {
    const inventory = scanVitest(`
const test = (name: string, run: () => void) => run();
function describe(title: string) {}
export default class {}
class Feed {
  constructor(private readonly url: string, ...rest: string[]) {}
}
try {} catch ({ message }) {}
test('this helper is not Vitest', () => {});
describe('neither is this');
`);
    expect(inventory.tests).toEqual([]);
    expect(inventory.suites).toEqual([]);
  });
});

describe('Vitest test objects derived with extend', () => {
  it('follows extend in both forms, chained, and inline', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
const withClient = test.extend({ client: async ({}, use) => use(createClient()) });
const withAccount = withClient.extend('account', { buyingPower: 25_000 }).extend({ symbols: ['AAPL'] });
const viaIt = it.extend({ fees: 0 });
import * as vt from 'vitest';
const viaNamespace = vt.test.extend({ venue: 'NASDAQ' });
withClient('fetches daily candles', ({ client }) => {});
withAccount('validates an order', ({ account }) => {});
viaIt('charges no fee', () => {});
viaNamespace('lists the venue', () => {});
test.extend({ broker: 'paper' }).skip('fills a paper order', () => {});
withAccount.override({ symbols: ['MSFT'] });
withAccount.scoped({ symbols: ['NVDA'] });
test.extend({ exchange: 'NASDAQ' });
`);
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([
      ['fetches daily candles', 'active'],
      ['validates an order', 'active'],
      ['charges no fee', 'active'],
      ['lists the venue', 'active'],
      ['fills a paper order', 'skip'],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads describe and suite on the test object, and test on describe', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test.describe('stop-loss', () => {
  it.suite.skip('trailing stops', () => {
    describe.test('raises a long stop', () => {});
  });
});
`);
    expect(inventory.suites.map((suite) => [suite.title, suite.isSkipped])).toEqual([
      ['stop-loss', false],
      ['trailing stops', true],
    ]);
    expect(onlyTest(inventory)).toMatchObject({
      fullName: 'stop-loss > trailing stops > raises a long stop',
      state: 'skip',
    });
  });
});

describe('Vitest declarations', () => {
  it.each([
    ['test.skip', { state: 'skip', stateSource: 'test' }],
    ['test.todo', { state: 'todo' }],
    ['test.fails', { state: 'expectedToFail' }],
    ['test.only', { state: 'active', isOnly: true }],
    ['test.concurrent', { state: 'active', isParallel: true }],
    ['test.only.skip', { state: 'active', isOnly: true }],
    ['test.skip.only', { state: 'active', isOnly: true }],
    ['test.skip.todo', { state: 'skip' }],
    ['test.todo.fails', { state: 'todo' }],
    ['test.only.fails', { state: 'expectedToFail', isOnly: true }],
    ['test.skipIf(true).only', { state: 'active', isOnly: true }],
    ['test.skipIf(true)', { state: 'skip', isConditional: false }],
    ['test.skipIf(false)', { state: 'active' }],
    ['test.runIf(true)', { state: 'active' }],
    ['test.runIf(false)', { state: 'skip', isConditional: false }],
    ["test.skipIf(process.platform === 'win32')", { state: 'skip', condition: "process.platform === 'win32'" }],
    ['test.runIf(process.env.MARKET_DATA_KEY)', { state: 'skip', condition: '!(process.env.MARKET_DATA_KEY)' }],
    ['test.skipIf(isWeekend()).runIf(hasApiKey)', { state: 'skip', condition: 'isWeekend() || !(hasApiKey)' }],
  ])('reads %s', (callee, expected) => {
    const test = onlyTest(scanVitest(`${VITEST_IMPORT}\n${callee}('computes the daily return', () => {});`));
    expect(test).toMatchObject({ isOnly: false, isConditional: 'condition' in expected, ...expected });
  });

  it.each([
    ['{ skip: true }', { state: 'skip', isConditional: false }],
    ['{ skip: false, todo: true }', { state: 'todo' }],
    ['{ only: true, skip: true }', { state: 'active', isOnly: true }],
    ['{ fails: true }', { state: 'expectedToFail' }],
    ['{ concurrent: true, timeout: 10_000, retry: 2 }', { state: 'active', isParallel: true }],
    ['{ skip: !process.env.CI }', { state: 'skip', condition: '!process.env.CI' }],
    ['OPTIONS', { state: 'skip', isConditional: false }],
  ])('reads the options %s', (options, expected) => {
    const test = onlyTest(
      scanVitest(`${VITEST_IMPORT}
const OPTIONS = { skip: true };
test('rejects a fractional quantity', ${options}, () => {});
`),
    );
    expect(test).toMatchObject(expected);
  });

  it('reads a test without a function as todo', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test('borrows shares before a short sale');
test('closes a short with a buy to cover', { tags: ['orders'] });
`);
    expect(inventory.tests.map((test) => [test.state, test.bodyHash])).toEqual([
      ['todo', null],
      ['todo', null],
    ]);
  });

  it('reads a test whose function is passed by name as a test without a body hash', () => {
    const test = onlyTest(
      scanVitest(`${VITEST_IMPORT}
import { checkRoundTrip } from './round-trip';
test('round-trips an order through JSON', checkRoundTrip);
`),
    );
    expect(test).toMatchObject({ state: 'active', bodyHash: null });
  });

  it('reads a test with spread arguments with an unknown title', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test(...cases[0]);
`);
    expect(onlyTest(inventory)).toMatchObject({ title: '...cases[0]', hasDynamicTitle: true, state: 'active' });
  });

  it('uses the name of a function declared in the file as the title', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { calculateRsi } from './rsi';
function calculateSma() {}
class OrderBook {}
describe(calculateSma, () => {
  test(OrderBook, () => {});
  test(calculateRsi, () => {});
});
`);
    expect(inventory.suites[0].title).toBe('calculateSma');
    expect(inventory.tests.map((test) => [test.title, test.hasDynamicTitle])).toEqual([
      ['OrderBook', false],
      ['calculateRsi', true],
    ]);
  });

  it('keeps @ words in Vitest titles, which are not tags', () => {
    const test = onlyTest(scanVitest(`${VITEST_IMPORT}\ntest('emails @trader when the order fills', () => {});`));
    expect(test).toMatchObject({ titleWithoutTags: 'emails @trader when the order fills', tags: [] });
  });

  it('accepts options as the third argument in Vitest 3 and reports it from Vitest 4', () => {
    const code = `${VITEST_IMPORT}
test('fills a stop order', () => {}, { retry: 3, skip: true });
test('fills a limit order', () => {}, 5_000);
`;
    expect(scanVitest(code, { frameworkVersion: '3.2.4' }).tests.map((test) => test.state)).toEqual(['skip', 'active']);
    const inventory = scanVitest(code, { frameworkVersion: '4.0.0' });
    expect(titles(inventory)).toEqual(['fills a limit order']);
    expect(inventory.diagnostics).toMatchObject([
      { code: 'removed-api', level: 'error', source: '{ retry: 3, skip: true }' },
    ]);
  });

  it('reports sequential from Vitest 5 and reads it as the default mode before', () => {
    const code = `${VITEST_IMPORT}
describe.concurrent('indicators', () => {
  describe.sequential('rsi', () => {
    test('stays between 0 and 100', () => {});
  });
  test.sequential('sma averages', () => {});
});
`;
    const before = scanVitest(code, { frameworkVersion: '4.1.2' });
    expect(before.tests.map((test) => test.isParallel)).toEqual([false, false]);
    expect(codes(scanVitest(code))).toEqual(['removed-api', 'removed-api']);
  });

  it('reports chains that are not part of the API', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test.shuffle('random order', () => {});
test.only(true).skip('called modifier', () => {});
test.each.only('table never given', () => {});
test.skipIf.only('condition never given', () => {});
test.retry('unknown modifier', () => {});
`);
    expect(inventory.tests).toEqual([]);
    expect(codes(inventory)).toEqual([
      'invalid-chain',
      'invalid-chain',
      'invalid-chain',
      'invalid-chain',
      'invalid-chain',
    ]);
  });

  it('treats a table or condition that is never called with a title as no test', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
const skipOnWindows = test.skipIf(process.platform === 'win32');
const forEachSymbol = test.each(['AAPL', 'MSFT']);
test();
`);
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads tags from Vitest 4.1 and warns that config tags can change states', () => {
    // Built from parts, because Vitest reads module tags from this test file's own text.
    const moduleTag = '// @module' + '-tag market-data';
    const code = `${moduleTag}
${VITEST_IMPORT}
import { TAGS } from './tags';
describe('candles', { tags: 'slow' }, () => {
  test('downloads a year of candles', { tags: ['network', TAGS.flaky] }, () => {});
});
`;
    const inventory = scanVitest(code);
    expect(onlyTest(inventory).tags).toEqual(['market-data', 'slow', 'network']);
    expect(inventory.suites[0].tags).toEqual(['slow']);
    expect(codes(inventory)).toEqual(['config-may-change-state', 'unresolved-tag']);
    const older = scanVitest(code, { frameworkVersion: '4.0.18' });
    expect(onlyTest(older).tags).toEqual([]);
    expect(codes(older)).toEqual([]);
  });

  it('reads meta with literal values, merged from describes', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
const OWNER = 'risk-team';
describe('position sizing', { meta: { owner: OWNER, area: 'risk', ticket: getTicket() } }, () => {
  test('caps the size at the cash available', { meta: { area: 'sizing', reviewed: true, limits: [1, 2] } }, () => {});
  test('rounds down to whole shares', { meta: { notes: undefined } }, () => {});
});
`);
    expect(inventory.suites[0].meta).toEqual({ owner: 'risk-team', area: 'risk' });
    expect(inventory.tests.map((test) => test.meta)).toEqual([
      { owner: 'risk-team', area: 'sizing', reviewed: true, limits: [1, 2] },
      { owner: 'risk-team', area: 'risk' },
    ]);
  });
});

describe('Vitest describes', () => {
  it.each([
    ['describe.skip', { isSkipped: true }],
    ['describe.todo', { isTodo: true }],
    ['describe.only', { isOnly: true }],
    ['describe.concurrent', { isParallel: true }],
    ['describe.shuffle', { isShuffled: true }],
    ['describe.skipIf(isCI)', { isSkipped: true, isConditional: true, condition: 'isCI' }],
    ['describe.runIf(hasBroker)', { isSkipped: true, condition: '!(hasBroker)' }],
    ['describe.only.skip', { isOnly: true, isSkipped: false }],
  ])('reads %s', (callee, expected) => {
    const inventory = scanVitest(
      `${VITEST_IMPORT}\n${callee}('crossover', () => {\n  test('buys on a cross', () => {});\n});`,
    );
    expect(inventory.suites[0]).toMatchObject(expected);
  });

  it('reads the test function Vitest passes to a describe callback', () => {
    const inventory = scanVitest(`
import { describe } from 'vitest';
describe('market orders', (test) => {
  test('fills at the best ask', () => {});
  test.skip('fills after the close', () => {});
});
describe('limit orders', (t) => {
  t('rests on the book', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state])).toEqual([
      ['market orders > fills at the best ask', 'active'],
      ['market orders > fills after the close', 'skip'],
      ['limit orders > rests on the book', 'active'],
    ]);
    expect(codes(inventory)).toEqual([]);
  });

  it('reads shuffle and concurrent from options', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
describe('backtests', { shuffle: true, concurrent: true }, () => {
  test('replays 2023', () => {});
});
`);
    expect(inventory.suites[0]).toMatchObject({ isShuffled: true, isParallel: true });
    expect(onlyTest(inventory).isParallel).toBe(true);
  });

  it('reads a describe without a function as todo, with its tests todo too', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
describe('margin calls');
describe('portfolio margin', { skip: false });
`);
    expect(inventory.suites.map((suite) => suite.isTodo)).toEqual([true, true]);
  });

  it('reports a describe that only has a function, which Vitest never calls', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
describe(() => {
  test('is never collected', () => {});
});
`);
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics).toMatchObject([{ code: 'describe-not-called', level: 'error' }]);
  });

  it('marks tests in a skipped or todo describe', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
describe.todo('short selling', () => {
  test('borrows shares', () => {});
});
describe.skip('options', () => {
  test.only('prices a call', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.stateSource, test.isOnly])).toEqual([
      ['borrows shares', 'todo', 'suite', false],
      ['prices a call', 'skip', 'suite', true],
    ]);
    expect(codes(inventory)).toEqual(['only-in-skipped-describe']);
  });
});

describe('Vitest tables', () => {
  it('counts the cases of array tables, also through constants and as const', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
const CASES = [[187.5, 185.5, 250], [400, 399.5, 25]] as const;
test.each(CASES)('sizes a $%d entry', () => {});
test.for([{ symbol: 'AAPL' }, { symbol: 'MSFT' }, { symbol: 'NVDA' }])('quotes $symbol', () => {});
describe.each([['long'], ['short']])('%s stops', () => {
  test('moves only in the trade direction', () => {});
  test.each([[0.01], [0.02], [0.05]])('trails by %d', () => {});
  describe.for(STRATEGIES)('with $name', () => {
    test('exits at the target', () => {});
  });
});
test.each([[new Date('2024-01-02'), 1], [new Date('2024-01-03'), 2]])('reads day %s', () => {});
`);
    // A test in a describe table runs once per case of every table around it.
    expect(inventory.tests.map((test) => [test.isParameterized, test.caseCount])).toEqual([
      [true, 2],
      [true, 3],
      [true, 2],
      [true, 6],
      [true, null],
      [true, 2],
    ]);
    expect(inventory.suites[0]).toMatchObject({ isParameterized: true });
    expect(codes(inventory)).toEqual(['unresolved-cases']);
  });

  it('counts the rows of a tagged template table', () => {
    const test = onlyTest(
      scanVitest(`${VITEST_IMPORT}
test.each\`
  entry     | stop      | expected
  \${187.5} | \${185.5} | \${250}
  \${400}   | \${399.5} | \${25}
\`('risks 1% between $entry and $stop', ({ entry, stop, expected }) => {});
`),
    );
    expect(test.caseCount).toBe(2);
  });

  it('warns when the cases cannot be counted', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { HISTORICAL_CLOSES } from './fixtures/closes';
test.each(HISTORICAL_CLOSES)('matches the reference SMA on %s', () => {});
test.each([...HISTORICAL_CLOSES, [100]])('includes the extra close', () => {});
test.for\`
  symbol | price
  \${'AAPL'}
\`('has an odd table', () => {});
test.each\`\`('has an empty template', () => {});
test.each()('has no table', () => {});
`);
    expect(inventory.tests.map((test) => test.caseCount)).toEqual([null, null, null, null, null]);
    expect(codes(inventory)).toEqual(Array(5).fill('unresolved-cases'));
  });
});

describe('Vitest context and hooks', () => {
  it('reads skip from the test context, destructured, renamed or on the context object', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test('needs a market data key', ({ skip }) => {
  skip(!process.env.MARKET_DATA_KEY, 'no market data key');
});
test('runs on weekdays', ({ skip: skipTest, expect }) => {
  if (isWeekend()) skipTest('markets are closed');
});
test('needs the live broker', (context) => {
  context.skip();
});
test.for([['AAPL']])('quotes %s', ([symbol], { skip }) => {
  skip(symbol === 'AAPL', 'quote feed for AAPL is delayed');
});
test.each([['MSFT']])('charts %s', (symbol) => {
  skip();
});
`);
    expect(inventory.tests.map((test) => [test.state, test.condition, test.reason])).toEqual([
      ['skip', '!process.env.MARKET_DATA_KEY', 'no market data key'],
      ['skip', 'isWeekend()', 'markets are closed'],
      ['skip', null, null],
      ['skip', "symbol === 'AAPL'", 'quote feed for AAPL is delayed'],
      ['active', null, null],
    ]);
  });

  it('applies a skip in beforeEach or aroundEach to the tests in the describe', () => {
    const inventory = scanVitest(`
import { aroundEach, beforeAll, beforeEach, describe, test } from 'vitest';
describe('broker integration', () => {
  beforeEach((context) => {
    context.skip(!process.env.BROKER_URL);
  });
  test('sends an order', () => {});
});
describe('paper broker', () => {
  aroundEach(async (runTest, { skip }) => {
    skip(process.env.PAPER === 'off', 'paper broker is off');
    await runTest();
  });
  beforeAll(() => {});
  test.beforeEach(() => {});
  test('fills at the last price', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.state, test.condition, test.stateSource])).toEqual([
      ['skip', '!process.env.BROKER_URL', 'suite'],
      ['skip', "process.env.PAPER === 'off'", 'suite'],
    ]);
  });

  it('ignores calls that only look like a context skip', () => {
    const test = onlyTest(
      scanVitest(`${VITEST_IMPORT}
test('reads the order book', (context, { skip } = {}) => {
  context.task.skip();
  context.skip.call(null);
  other.skip();
});
`),
    );
    expect(test.state).toBe('active');
  });

  it('reports a test declared in a hook', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { beforeEach } from 'vitest';
beforeEach(() => {
  test('is not collected', () => {});
});
`);
    expect(codes(inventory)).toEqual(['nested-test']);
  });
});

describe('Vitest type tests', () => {
  it('marks tests in *.test-d.ts files', () => {
    const inventory = scanVitest(
      `
import { expectTypeOf, test } from 'vitest';
import type { Order } from '../src/orders/order';
test('narrows a limit order', () => {
  expectTypeOf<Order>().toHaveProperty('quantity');
});
`,
      { relativeFilePath: 'tests/orders/order.test-d.ts' },
    );
    expect(onlyTest(inventory).isTypeTest).toBe(true);
    expect(inventory.summary.typeTestCount).toBe(1);
  });

  it('never marks Playwright tests as type tests', () => {
    expect(testNamed(scanVitest(`${VITEST_IMPORT}\ntest('a', () => {});`), 'a').isTypeTest).toBe(false);
  });
});

describe('Vitest forms that are rare but valid', () => {
  it('binds in-source names from string keys and skips patterns it cannot read', () => {
    const inventory = scanVitest(`
if (import.meta.vitest) {
  const { 'it': check, describe: { skip }, [hookName]: hook, ...rest } = import.meta.vitest;
  const { url, ...options } = { url: 'https://example.com' };
  check('formats a price', () => {});
}
`);
    expect(titles(inventory)).toEqual(['formats a price']);
  });

  it('ignores namespace calls and computed members that are not test functions', () => {
    const inventory = scanVitest(`
import * as vt from 'vitest';
import { test } from 'vitest';
const viaKey = vt[key].extend({});
const viaComputed = test[key]({});
vt('is not a test');
test[key]('is not a test either', () => {});
viaKey('is not followed', () => {});
`);
    expect(inventory.tests).toEqual([]);
  });

  it('reads skip calls with spread arguments and context patterns it cannot read', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test('skips with spread arguments', ({ skip }) => {
  skip(...reasons);
});
test('skips with a spread note', ({ skip }) => {
  skip(isWeekend(), ...notes);
});
test('reads a string key', ({ 'skip': skipNow, ...rest }) => {
  skipNow();
});
test('ignores a nested pattern', ({ skip: { call } }) => {
  call();
});
`);
    expect(inventory.tests.map((test) => [test.state, test.condition, test.reason])).toEqual([
      ['skip', '...reasons', null],
      ['skip', 'isWeekend()', '...notes'],
      ['skip', null, null],
      ['active', null, null],
    ]);
  });

  it('ignores meta that is not an object and counts template tables with invalid escapes', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test('reads meta from a call', { meta: getMeta() }, () => {});
test.each\`
  \\unit | value
  \${'kg'} | \${1}
\`('converts $unit', () => {});
`);
    expect(inventory.tests.map((test) => [test.meta, test.caseCount])).toEqual([
      [null, null],
      [null, 1],
    ]);
  });
});

describe('Vitest local names', () => {
  it('does not take a local name that shadows a Vitest function for it', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { vi } from 'vitest';
describe('order router', () => {
  const describe = vi.fn();
  describe.mockReturnValue('NASDAQ');
  for (const test of runner.tasks) test.result();
  it('routes to the venue with the best price', () => {});
});
`);
    expect(onlyTest(inventory).fullName).toBe('order router > routes to the venue with the best price');
    expect(inventory.diagnostics).toEqual([]);
  });

  it('ignores members that every function has, such as constructor', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test.constructor('return this')();
describe.hasOwnProperty('only');
it('rounds the fee up to the cent', () => {});
`);
    expect(titles(inventory)).toEqual(['rounds the fee up to the cent']);
    expect(codes(inventory)).toEqual(['invalid-chain', 'invalid-chain']);
  });

  it('takes a name typed with declare for the global it types', () => {
    const inventory = scanVitest(`import type { TestAPI } from 'vitest';
declare const it: TestAPI;
describe('fees', () => {
  it('charges the minimum', () => {});
});
`);
    expect(onlyTest(inventory).fullName).toBe('fees > charges the minimum');
  });

  it('follows a test object chosen by a condition', () => {
    const inventory = scanVitest(`import { test as vitestTest } from 'vitest';
const noop = () => {};
const test = process.env.BROKER_URL ? vitestTest : noop;
const replayTest = process.env.BROKER_URL ? noop : vitestTest;
test('streams live quotes', () => {});
replayTest('streams recorded quotes', () => {});
`);
    expect(titles(inventory)).toEqual(['streams live quotes', 'streams recorded quotes']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('applies the modifiers a test or describe function was created with', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
const testOnLinux = test.runIf(process.platform === 'linux');
const skipOnCi = it.skipIf(process.env.CI);
const concurrentOnCi = skipOnCi.concurrent;
const describeWithBroker = describe.skipIf(!process.env.BROKER_URL);
const fixtureName = test.name;
const venueName = venue.skip;
testOnLinux('reads the shared memory feed', () => {});
concurrentOnCi.each([['AAPL'], ['MSFT']])('replays a year of %s ticks', () => {});
describeWithBroker('live broker', () => {
  test('sends an order', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.condition, test.isParallel])).toEqual([
      ['reads the shared memory feed', 'skip', "!(process.platform === 'linux')", false],
      ['replays a year of %s ticks', 'skip', 'process.env.CI', true],
      ['live broker > sends an order', 'skip', '!process.env.BROKER_URL', false],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads describe functions kept in a variable, also chosen by a condition', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
const suiteOf = describe;
const describeOnCi = process.env.CI ? describe.concurrent.skipIf(!process.env.BROKER_URL) : describe.concurrent;
const testOnCi = process.env.CI ? test.concurrent : it.concurrent.skip;
const ordered = describe.sequential;
const mixed = process.env.CI ? it.skip : describe;
const tableOnCi = process.env.CI ? describe.each([['AAPL']]) : describe.each([['MSFT']]);
suiteOf('fees', () => {});
describeOnCi('broker', () => {
  testOnCi('sends an order', () => {});
});
mixed('rounds the fee', () => {});
tableOnCi('quotes for %s', () => {});
ordered('fills', () => {});
`);
    expect(inventory.suites.map((suite) => [suite.title, suite.isSkipped, suite.isParallel])).toEqual([
      ['fees', false, false],
      ['broker', false, true],
      ['quotes for %s', false, false],
    ]);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.isParallel])).toEqual([
      ['broker > sends an order', 'active', true],
    ]);
    expect(inventory.diagnostics).toMatchObject([
      { code: 'removed-api', message: 'sequential was removed in Vitest 5; ordered(...) fails.' },
    ]);
  });

  it('reads functions kept in a variable from globals, also derived with extend', () => {
    const inventory = scanVitest(`const skipOnCi = it.skipIf(process.env.CI);
const brokerTest = it.extend({ broker: 'paper' });
describe('fees', () => {
  skipOnCi('charges the minimum', () => {});
  brokerTest('charges the exchange fee', ({ broker }) => {});
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.condition])).toEqual([
      ['fees > charges the minimum', 'skip', 'process.env.CI'],
      ['fees > charges the exchange fee', 'active', null],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads calls on a local test object created by a call it cannot follow, with one warning', () => {
    const inventory = scanVitest(`import { describe } from 'vitest';
import { createRunnerTester } from './runner';
const it = await createRunnerTester({ broker: 'paper' });
const suite = createRunnerTester({ broker: 'paper' }).describe;
const liveTest = createRunnerTester({ broker: 'live' });
describe('paper broker', () => {
  it('fills at the last price', async ({ runner }) => {});
  it.skip('fills after the close', async ({ runner }) => {});
});
suite('fees', () => {});
liveTest('sends an order', async ({ runner }) => {});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state])).toEqual([
      ['paper broker > fills at the last price', 'active'],
      ['paper broker > fills after the close', 'skip'],
      ['sends an order', 'active'],
    ]);
    expect(inventory.suites.map((suite) => suite.title)).toEqual(['paper broker', 'fees']);
    expect(inventory.diagnostics).toMatchObject([
      { code: 'local-test-object', lineStart: 3, source: "await createRunnerTester({ broker: 'paper' })" },
      { code: 'local-test-object', lineStart: 4 },
      { code: 'local-test-object', lineStart: 5 },
    ]);
  });
});

describe('Vitest options and context', () => {
  it('reads options from an import as options, keeps the body, and reports what it cannot work out', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { SLOW, OWNERS, isNightly } from './settings';
test('backtests a year', SLOW, () => {
  expect(1).toBe(1);
});
test('backtests a month', { ...SLOW, concurrent: isNightly, meta: { owner: OWNERS.risk, area: 'backtests' } }, () => {});
test('backtests a week', { meta: OWNERS }, () => {});
const TIMEOUT = 10_000;
const BENCHMARKS = ['SPY'];
const NONE = null;
test('backtests a decade', () => {}, TIMEOUT);
test('backtests a century', () => {}, BENCHMARKS);
test('backtests nothing', () => {}, NONE);
test('backtests a quarter', () => {}, SLOW_TIMEOUT);
`);
    expect(inventory.tests.map((test) => [test.title, test.bodyHash !== null, test.meta])).toEqual([
      ['backtests a year', true, null],
      ['backtests a month', true, { area: 'backtests' }],
      ['backtests a week', true, null],
      ['backtests a decade', true, null],
      ['backtests a century', true, null],
      ['backtests nothing', true, null],
      ['backtests a quarter', true, null],
    ]);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Options object SLOW comes from './settings' and could not be worked out; its flags, tags and meta are missing.",
      "Options object SLOW comes from './settings' and could not be worked out; its flags, tags and meta are missing.",
      "Option concurrent: isNightly comes from './settings' and could not be worked out; it is not applied.",
      "Option meta.owner: OWNERS.risk comes from './settings' and could not be worked out; the value is missing.",
      "Options object OWNERS comes from './settings' and could not be worked out; its meta values are missing.",
    ]);
  });

  it('turns parallel off with concurrent: false, in a test or a describe', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
describe.concurrent('indicators', () => {
  test('touches shared state', { concurrent: false }, () => {});
  test('computes the SMA', () => {});
});
describe('order book', { concurrent: false }, () => {
  test.concurrent('streams quotes', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.title, test.isParallel])).toEqual([
      ['touches shared state', false],
      ['computes the SMA', true],
      ['streams quotes', true],
    ]);
    expect(inventory.suites.map((suite) => suite.isParallel)).toEqual([true, false]);
  });

  it('reads context.skip(false) and skip(true) as conditions, and a string as the note', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test('runs', (ctx) => {
  ctx.skip(false);
});
test('is skipped', (ctx) => {
  ctx.skip(true, 'paper broker only');
});
test('is skipped with a note', ({ skip }) => {
  skip(\`needs \${'a broker'}\`);
});
`);
    expect(inventory.tests.map((test) => [test.state, test.condition, test.reason])).toEqual([
      ['active', null, null],
      ['skip', null, 'paper broker only'],
      ['skip', null, 'needs a broker'],
    ]);
  });

  it('reads the first argument of context.skip() as the note before Vitest 3.1', () => {
    const code = `${VITEST_IMPORT}
test('needs live quotes', (ctx) => {
  ctx.skip(isWeekend(), 'markets are closed');
});
`;
    expect(onlyTest(scanVitest(code, { frameworkVersion: '3.0.9' }))).toMatchObject({
      state: 'skip',
      condition: null,
      reason: 'isWeekend()',
      hasDynamicReason: true,
    });
    expect(onlyTest(scanVitest(code, { frameworkVersion: '3.1.0' }))).toMatchObject({
      state: 'skip',
      condition: 'isWeekend()',
      reason: 'markets are closed',
      hasDynamicReason: false,
    });
  });

  it('reads module tags exactly as Vitest does', () => {
    // Built from parts, because Vitest reads this word from the text of this file too.
    const tag = ['@module', 'tag'].join('-');
    const inventory = scanVitest(`// see ${tag} docs for the rules
// ${tag} smoke, slow
/**
 * ${tag} nightly/risk
 */
${VITEST_IMPORT}
const note = '// ${tag} in-a-string';
test('sizes a position', () => {});
`);
    // Vitest needs the tag word right after `//` or `*`, takes word characters, `-` and `/`, and also reads strings.
    expect(onlyTest(inventory).tags).toEqual(['smoke', 'nightly/risk', 'in-a-string']);
  });

  it('turns a number, boolean or null title into a string, as Vitest does', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
describe(2026, () => {
  test(42, () => {});
  test(true, () => {});
  test(null, () => {});
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.hasDynamicTitle])).toEqual([
      ['2026 > 42', false],
      ['2026 > true', false],
      ['2026 > null', false],
    ]);
  });
});
