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

  it('reports calls to bench imported from vitest in Vitest 5, which no longer exports it', () => {
    const code = `import { bench, describe, test } from 'vitest';
describe('sma', () => {
  bench('20-day average over 10 years of closes', () => {});
  bench.skip('200-day average over 10 years of closes', () => {});
  test('reports its own timing', () => {
    const bench = startTimer('sma');
    bench.stop();
  });
});`;
    expect(scanVitest(code).diagnostics).toMatchObject([
      { code: 'removed-api', lineStart: 3, source: 'bench' },
      { code: 'removed-api', lineStart: 4, source: 'bench.skip' },
    ]);
    expect(codes(scanVitest(code, { frameworkVersion: '4.1.0' }))).toEqual([]);
    expect(
      codes(
        scanVitest(`import { bench, test } from 'vitest';
test('sizes a position', () => {});`),
      ),
    ).toEqual([]);
  });

  it('refuses a file from Vitest 5 when vi.mock, vi.unmock or vi.hoisted is not at its top level', () => {
    const code = `import { describe, test, vi } from 'vitest';
describe('quote cache', () => {
  vi.mock('./market-data-client', () => ({ fetchQuote: vi.fn() }));
  test('returns the cached quote for AAPL', () => {
    vi.unmock('./clock');
    vi.doMock('./clock');
  });
});
function fakeBroker() {
  return vi.hoisted(() => ({ placeOrder: vi.fn() }));
}
test('evicts quotes older than a minute', () => {});
`;
    const inventory = scanVitest(code);
    expect(inventory.tests.map((test) => [test.state, test.stateLine])).toEqual([
      ['notLoaded', 3],
      ['notLoaded', 3],
    ]);
    expect(inventory.diagnostics).toMatchObject([
      { code: 'removed-api', lineStart: 3, columnStart: 3, source: 'vi.mock' },
      { code: 'removed-api', lineStart: 5, columnStart: 5, source: 'vi.unmock' },
      { code: 'removed-api', lineStart: 10, columnStart: 10, source: 'vi.hoisted' },
    ]);
    const before = scanVitest(code, { frameworkVersion: '4.1.0' });
    expect(before.tests.map((test) => test.state)).toEqual(['active', 'active']);
    expect(codes(before)).toEqual([]);
  });

  it('accepts hoisted calls at the top level, in declarations and awaits, and in files with in-source tests', () => {
    expect(
      codes(
        scanVitest(`import { expect, test, vi } from 'vitest';
vi.mock('./broker', () => ({ placeOrder: vi.fn() }));
vitest.unmock('./clock');
const { submit } = vi.hoisted(() => ({ submit: vi.fn() }));
const fees = await vi.hoisted(async () => ({ rate: 0.001 }));
await vi.hoisted(async () => {});
vi.hoisted(() => {});
test('charges the fee rate', () => {
  vi.doMock('./broker');
  expect(fees.rate).toBe(0.001);
});
`),
      ),
    ).toEqual([]);
    const inSource = scanVitest(`import { vi } from 'vitest';
export function sma(closes: number[]): number {
  return closes.reduce((sum, close) => sum + close, 0) / closes.length;
}
if (import.meta.vitest) {
  const { test } = import.meta.vitest;
  vi.mock('./prices');
  test('averages the closes', () => {});
}
`);
    expect(onlyTest(inSource).state).toBe('active');
    expect(codes(inSource)).toEqual([]);
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
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([
      ['fills a stop order', 'notLoaded'],
      ['fills a limit order', 'notLoaded'],
    ]);
    expect(inventory.diagnostics).toMatchObject([
      { code: 'removed-api', level: 'error', source: '{ retry: 3, skip: true }' },
    ]);
  });

  it('reports sequential from Vitest 5 and reads it as the default mode before', () => {
    const code = `${VITEST_IMPORT}
const ordered = describe.sequential;
describe.concurrent('indicators', () => {
  describe.sequential('rsi', () => {
    test('stays between 0 and 100', () => {});
  });
  test.sequential('sma averages', () => {});
  ordered('macd', () => {
    test('crosses the signal line', () => {});
  });
});
`;
    const before = scanVitest(code, { frameworkVersion: '4.1.2' });
    expect(before.tests.map((test) => test.isParallel)).toEqual([false, false, false]);
    // From Vitest 5 the file fails, and the tests in it, also those in describes that use sequential, are not loaded.
    const after = scanVitest(code);
    expect(after.tests.map((test) => [test.fullName, test.state])).toEqual([
      ['indicators > rsi > stays between 0 and 100', 'notLoaded'],
      ['indicators > sma averages', 'notLoaded'],
      ['indicators > macd > crosses the signal line', 'notLoaded'],
    ]);
    expect(after.diagnostics).toMatchObject([
      { code: 'removed-api', message: 'sequential was removed in Vitest 5; describe.sequential(...) fails.' },
      { code: 'removed-api', message: 'sequential was removed in Vitest 5; test.sequential(...) fails.' },
      { code: 'removed-api', message: 'sequential was removed in Vitest 5; ordered(...) fails.' },
    ]);
  });

  it('reports chains that are not part of the API, and lists their tests as not loaded', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test.shuffle('random order', () => {});
test.only(true).skip('called modifier', () => {});
test.each.only('table never given', () => {});
test.skipIf.only('condition never given', () => {});
test.retry('unknown modifier', () => {});
test.serial('places a bracket order', () => {}, { retry: 2 });
test.beforeEach.only('signs in', () => {});
`);
    // Which part of a chain is meant is not known, so each is a plain test; a hook declares none.
    expect(inventory.tests.map((test) => [test.title, test.state, test.isOnly])).toEqual([
      ['random order', 'notLoaded', false],
      ['called modifier', 'notLoaded', false],
      ['table never given', 'notLoaded', false],
      ['condition never given', 'notLoaded', false],
      ['unknown modifier', 'notLoaded', false],
      ['places a bracket order', 'notLoaded', false],
    ]);
    // Vitest fails at the chain, before it gets to the options.
    expect(codes(inventory)).toEqual(Array(7).fill('invalid-chain'));
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

  it("lets a test's own options win over its chain, and a describe's chain win over its options", () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test.skip('fills a market order', { skip: false }, () => {});
test.skipIf(process.env.CI)('fills a limit order', { skip: false }, () => {});
test.todo('fills a stop order', { todo: false }, () => {});
test.skip('fills an iceberg order', { skip: false });
test.fails('fills a pegged order', { fails: false }, () => {});
test.only('fills a hidden order', { only: false }, () => {});
test('fills a peg-to-midpoint order', { skip: process.env.CI }, () => {});
describe.skip('bracket orders', { skip: false }, () => {
  test('attaches a take-profit', () => {});
});
describe.todo('one-cancels-other orders', { todo: false }, () => {
  test('cancels the other order', () => {});
});
`);
    expect(
      inventory.tests.map((test) => [test.title, test.state, test.condition, test.isExpectedToFail, test.isOnly]),
    ).toEqual([
      ['fills a market order', 'active', null, false, false],
      ['fills a limit order', 'active', null, false, false],
      ['fills a stop order', 'active', null, false, false],
      ['fills an iceberg order', 'todo', null, false, false],
      ['fills a pegged order', 'active', null, false, false],
      ['fills a hidden order', 'active', null, false, false],
      ['fills a peg-to-midpoint order', 'skip', 'process.env.CI', false, false],
      ['attaches a take-profit', 'skip', null, false, false],
      ['cancels the other order', 'todo', null, false, false],
    ]);
  });

  it("lets a test's chain set its mode over its options", () => {
    const inventory = scanVitest(
      `${VITEST_IMPORT}
test.concurrent('fills a market order', { concurrent: false }, () => {});
describe.concurrent('quotes', () => {
  test.sequential('streams quotes', { sequential: false }, () => {});
});
`,
      { frameworkVersion: '4.1.2' },
    );
    expect(inventory.tests.map((test) => [test.title, test.isParallel])).toEqual([
      ['fills a market order', true],
      ['streams quotes', false],
    ]);
  });

  it("passes a describe's skip option down to everything inside, where skip goes before todo", () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
describe('crypto desk', { skip: true }, () => {
  test.todo('trades on margin');
  test('settles in stablecoins');
  describe.todo('staking', () => {
    test('stakes ether', () => {});
  });
  describe.skip.todo('lending', () => {
    test('lends bitcoin', () => {});
  });
  describe('futures', { skip: false }, () => {
    test.todo('rolls a perpetual');
  });
});
describe('fx desk', { skip: process.env.CI }, () => {
  test.todo('quotes a forward');
});
// Its .only beats the describe's own skip, but what is inside gets the option and is skipped.
describe.only('rates desk', { skip: true }, () => {
  test.todo('quotes a swap');
  test('settles a bond', () => {});
  describe('treasuries', () => {
    test('rolls a bill', () => {});
  });
});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.stateSource, test.stateLine])).toEqual([
      ['trades on margin', 'skip', 'suite', 2],
      ['settles in stablecoins', 'skip', 'suite', 2],
      ['stakes ether', 'skip', 'suite', 2],
      ['lends bitcoin', 'skip', 'suite', 8],
      ['rolls a perpetual', 'todo', 'test', 12],
      ['quotes a forward', 'todo', 'test', 16],
      ['quotes a swap', 'skip', 'test', 19],
      ['settles a bond', 'skip', 'test', 19],
      ['rolls a bill', 'skip', 'suite', 19],
    ]);
    expect(inventory.suites.map((suite) => [suite.title, suite.isSkipped, suite.isTodo])).toEqual([
      ['crypto desk', true, false],
      ['staking', true, false],
      ['lending', true, false],
      ['futures', false, false],
      ['fx desk', true, false],
      ['rates desk', false, false],
      ['treasuries', true, false],
    ]);
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

  it('applies a skip in a function passed by name to beforeEach to the tests in the describe', () => {
    const inventory = scanVitest(`
import { beforeEach, describe, test } from 'vitest';
function requireBroker(context) {
  context.skip(!process.env.BROKER_URL, 'needs a broker');
}
describe('broker integration', () => {
  beforeEach(requireBroker);
  test('sends an order', () => {});
});
`);
    expect(onlyTest(inventory)).toMatchObject({
      state: 'skip',
      condition: '!process.env.BROKER_URL',
      reason: 'needs a broker',
      stateSource: 'suite',
    });
  });

  it('lets a skip in a body or a hook lose to a todo describe, which keeps the test from running', () => {
    const inventory = scanVitest(`
import { beforeEach, describe, test } from 'vitest';
describe.todo('short selling', () => {
  test('borrows shares', (context) => {
    context.skip();
  });
  describe('locates', () => {
    beforeEach((context) => {
      context.skip();
    });
    test('finds a lender', () => {});
  });
});
test.fails('rejects a naked short', (context) => {
  context.skip();
});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.stateSource, test.stateLine])).toEqual([
      ['borrows shares', 'todo', 'suite', 3],
      ['finds a lender', 'todo', 'suite', 3],
      ['rejects a naked short', 'skip', 'test', 15],
    ]);
  });

  it('reads a skip in a catch block as conditional, and one in a finally block as not', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
test('binds the IPv6 quote feed', async (context) => {
  try {
    await listen('::');
  } catch {
    context.skip();
    return;
  }
});
test('reads the broker certificate', ({ skip }) => {
  try {
    readCertificate();
  } catch (error) {
    if (error.code === 'ENOENT') skip('no certificate');
  }
});
test('closes the quote feed', (context) => {
  try {
    connect();
  } finally {
    context.skip();
  }
});
`);
    expect(inventory.tests.map((test) => [test.state, test.isConditional, test.condition])).toEqual([
      ['skip', true, 'catch'],
      ['skip', true, "catch (error) && error.code === 'ENOENT'"],
      ['skip', false, null],
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

describe('Vitest tests declared in helper functions', () => {
  it('reports a problem in a helper once, however many calls walk it', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { VENUE } from './venues';
function venueTests(side: string) {
  describe(VENUE, () => {
    it(\`routes a \${side} order\`, () => {});
  });
}
venueTests('buy');
venueTests('sell');
`);
    expect(inventory.tests.map((test) => test.fullName)).toEqual([
      'VENUE > routes a buy order',
      'VENUE > routes a sell order',
    ]);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.lineStart])).toEqual([
      ['dynamic-title', 4],
    ]);
  });

  it('allows a fixed title in a loop, as Vitest runs duplicate titles', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
for (const symbol of ['AAPL', 'MSFT']) {
  it('parses a quote', () => {});
}
`);
    expect(codes(inventory)).toEqual(['test-in-loop']);
    expect(onlyTest(inventory).state).toBe('active');
  });

  it('records shared tests that a helper declares in each describe that calls it', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
function behavesLikeAnOrder(type: string) {
  it(\`rejects a \${type} order without a quantity\`, () => {});
}
describe('market orders', () => behavesLikeAnOrder('market'));
describe('limit orders', () => behavesLikeAnOrder('limit'));
`);
    expect(inventory.tests.map((test) => [test.fullName, test.lineStart])).toEqual([
      ['market orders > rejects a market order without a quantity', 3],
      ['limit orders > rejects a limit order without a quantity', 3],
    ]);
    expect(inventory.diagnostics).toEqual([]);
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
const mixed = process.env.CI ? it.skip : describe;
const tableOnCi = process.env.CI ? describe.each([['AAPL']]) : describe.each([['MSFT']]);
suiteOf('fees', () => {});
describeOnCi('broker', () => {
  testOnCi('sends an order', () => {});
});
mixed('rounds the fee', () => {});
tableOnCi('quotes for %s', () => {});
`);
    expect(inventory.suites.map((suite) => [suite.title, suite.isSkipped, suite.isParallel])).toEqual([
      ['fees', false, false],
      ['broker', false, true],
      ['quotes for %s', false, false],
    ]);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.isParallel])).toEqual([
      ['broker > sends an order', 'active', true],
    ]);
    expect(inventory.diagnostics).toEqual([]);
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

  it('reads tests on the function a function in the file returns, called in place or kept in a variable', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
const onFeed = (feed: string) => (feed === 'NASDAQ' ? test : test.fails);
function onNode(major: number) {
  if (Number(process.versions.node.split('.')[0]) < major) {
    return it.concurrent.skip;
  }
  return it.concurrent;
}
function deskSuite() {
  const suite = describe.shuffle;
  return suite;
}
const tapeTest = onNode(22);
const nyseTest = () => onFeed('NYSE');
const fastTest = () => onNode(22);
deskSuite()('quotes', () => {
  onFeed('NASDAQ')('streams NASDAQ quotes', () => {});
  onNode(22)('reads the order book', () => {});
  onNode(22).skip.each([['AAPL'], ['MSFT']])('charts %s', () => {});
  tapeTest('reads the tape', () => {});
  nyseTest()('streams NYSE quotes', () => {});
  fastTest()('reads the tape fast', () => {});
});
`);
    expect(inventory.suites.map((suite) => [suite.title, suite.isShuffled])).toEqual([['quotes', true]]);
    // As for a variable chosen by a condition, only the modifiers every value has apply.
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.isParallel, test.caseCount])).toEqual([
      ['quotes > streams NASDAQ quotes', 'active', false, null],
      ['quotes > reads the order book', 'active', true, null],
      ['quotes > charts %s', 'skip', true, 2],
      ['quotes > reads the tape', 'active', true, null],
      ['quotes > streams NYSE quotes', 'active', false, null],
      ['quotes > reads the tape fast', 'active', true, null],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('does not read what a function returns as a test function unless every value it returns is one', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
const feedTest = (feed: string) => (feed === 'NASDAQ' ? test : describe);
function quoteTest(symbol: string) {
  if (!symbol) return;
  return test;
}
function bookTest() {
  const pick = () => test;
  return pick;
}
async function liveTest() {
  return test;
}
function* replayTest() {
  return test;
}
const ledgerTest = () => openLedger();
const forFeed = (feed: string) => (symbol: string) => test;
function relayTest(): unknown {
  return roundTripTest();
}
function roundTripTest(): unknown {
  return relayTest();
}
function firstFill(fills: unknown[]) {
  const [it] = fills;
  return it;
}
const opening = firstFill([]);
feedTest('NASDAQ')('streams NASDAQ quotes', () => {});
quoteTest('AAPL')('quotes AAPL', () => {});
bookTest()('reads the order book', () => {});
liveTest()('sends a live order', () => {});
replayTest()('replays the open', () => {});
ledgerTest()('reads the ledger', () => {});
forFeed('NASDAQ')('AAPL')('quotes AAPL', () => {});
relayTest()('relays an order', () => {});
opening.toString();
test('places an order', () => {});
`);
    expect(titles(inventory)).toEqual(['places an order']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads calls on what an unknown function named like a test object returns, with one warning', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { createVenue, liveBrokerTest } from '@trading/test-utils';
liveBrokerTest({ venue: 'NYSE' })('sends a live order', () => {});
liveBrokerTest({ venue: 'NASDAQ' }).skip('cancels a live order', () => {});
liveBrokerTest({ venue: 'NYSE' }).connect();
createVenue('NYSE')('opens the venue', () => {});
`);
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([
      ['sends a live order', 'active'],
      ['cancels a live order', 'skip'],
    ]);
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'local-test-object',
        lineStart: 3,
        message:
          "What liveBrokerTest({ venue: 'NYSE' }) returns is not followed; calls on it shaped like tests are read as tests.",
        source: "liveBrokerTest({ venue: 'NYSE' })",
      },
    ]);
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
      'Option timeout: BENCHMARKS is not a whole number; it is not applied.',
      'Option timeout: NONE is not a whole number; it is not applied.',
      'Option timeout: SLOW_TIMEOUT could not be worked out; it is not applied.',
    ]);
    expect(inventory.tests.map((test) => test.timeout)).toEqual([null, null, null, 10_000, null, null, null]);
  });

  it('reads imported options before a body passed by name, without taking the body for a timeout', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { SLOW } from './settings';
import { checkMargin } from './checks';
function checkExposure() {}
test('checks exposure', SLOW, checkExposure);
test('checks margin', SLOW, checkMargin);
`);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([]);
    expect(inventory.tests.map((test) => test.timeout)).toEqual([null, null]);
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
