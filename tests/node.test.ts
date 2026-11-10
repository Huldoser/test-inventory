import { describe, expect, it } from 'vitest';
import type { Inventory } from '../src/index.ts';
import { codes, onlyTest, scanNode } from './helpers.ts';

function states(inventory: Inventory): [string, string, string | null, string | null][] {
  return inventory.tests.map((test) => [test.fullName, test.state, test.reason, test.condition]);
}

describe('node:test tests', () => {
  it.each(['0', '-1', '1.5', '4294967296', '1e400', "'many'", '{}', '[]'])(
    'reports a startup refusal for invalid concurrency %s',
    (concurrency) => {
      const inventory = scanNode(`
import { test } from 'node:test';
test('routes a market order', { concurrency: ${concurrency} }, () => {});
test('quotes a spread', () => {});
`);
      expect(inventory.tests.map((test) => test.state)).toEqual(['notLoaded', 'notLoaded']);
      expect(inventory.diagnostics.map(({ code, level }) => [code, level])).toEqual([['unresolved-option', 'error']]);
      expect(inventory.diagnostics[0].message).toContain('concurrency');
    },
  );

  it('warns when the concurrency value cannot be worked out', () => {
    const inventory = scanNode(
      "import { test } from 'node:test'; test('routes an order', { concurrency: process.env.THREADS }, () => {});",
    );
    expect(inventory.tests[0].state).toBe('active');
    expect(inventory.diagnostics.map(({ code, level }) => [code, level])).toEqual([['unresolved-option', 'warning']]);
  });

  it.each(['false', '1', '2'])('applies a subtest concurrency override %s', (concurrency) => {
    const inventory = scanNode(`
import { test } from 'node:test';
test('routes an order basket', { concurrency: true }, (context) => {
  context.test('routes a market order', { concurrency: ${concurrency} }, () => {});
});
`);
    expect(inventory.tests.map((test) => test.isParallel)).toEqual([true, concurrency === '2']);
    expect(codes(inventory)).toEqual([]);
  });

  it.each(['', ', { concurrency: null }', ', { concurrency: undefined }'])(
    'inherits concurrency through parent tests with unset options %s',
    (options) => {
      const inventory = scanNode(`
import { test } from 'node:test';
test('routes an order basket', { concurrency: true }, (context) => {
  context.test('routes a market order'${options}, () => {});
});
`);
      expect(inventory.tests.map((test) => test.isParallel)).toEqual([true, true]);
      expect(codes(inventory)).toEqual([]);
    },
  );

  it('reads node:test imported whole, by name or with require(), and no globals', () => {
    const imported = scanNode(`
import test, { describe, it, suite } from 'node:test';
test('prices a spread', () => {});
describe('quote book', () => {
  it('keeps the best bid', () => {});
  suite('tiers', () => {
    test.it('widens the retail quote', () => {});
  });
});
`);
    expect(imported.tests.map((test) => test.fullName)).toEqual([
      'prices a spread',
      'quote book > keeps the best bid',
      'quote book > tiers > widens the retail quote',
    ]);
    const members = scanNode(`
import test, { mock, skip, todo } from 'node:test';
import * as nt from 'node:test';
test.mock.fn();
nt.mock.timers.enable({ apis: ['Date'] });
mock.method(Math, 'random');
test.beforeEach(() => {});
nt.after(() => {});
nt[process.env.HOOK](() => {});
skip('reprices on a holiday', () => {});
todo('reprices after hours');
nt.test('reprices at the open', () => {});
`);
    expect(members.tests.map((test) => [test.title, test.state])).toEqual([
      ['reprices on a holiday', 'skip'],
      ['reprices after hours', 'todo'],
      ['reprices at the open', 'active'],
    ]);
    expect(members.files[0].hooks).toMatchObject({ beforeEach: 1, afterAll: 1 });
    expect(codes(members)).toEqual([]);
    const required = scanNode(`
const test = require('node:test');
const { describe } = require('node:test');
test('crosses EUR into GBP', () => {});
describe('rates', () => {
  require('node:test').it('refuses a missing currency', () => {});
});
`);
    expect(required.tests.map((test) => test.fullName)).toEqual([
      'crosses EUR into GBP',
      'rates > refuses a missing currency',
    ]);
    expect(scanNode("it('uses no import', () => {});").tests).toEqual([]);
  });

  it("reads a function passed by name as the test's function, and its name as the title when there is no other", () => {
    const inventory = scanNode(`
import { test } from 'node:test';
async function fillsMarketOrder() {
  await placeOrder('AAPL');
}
const fillsLimitOrder = async () => {
  await placeOrder('MSFT', 410.5);
};
test('fills a market order', fillsMarketOrder);
test(fillsMarketOrder);
test(fillsLimitOrder);
test('fills with options', { timeout: 500 }, fillsMarketOrder);
`);
    // Node.js 26.12.1 runs all four, the second and third titled with the function's name.
    expect(inventory.tests.map((test) => [test.title, test.timeout, test.bodyHash === null])).toEqual([
      ['fills a market order', null, false],
      ['fillsMarketOrder', null, false],
      ['fillsLimitOrder', null, false],
      ['fills with options', 500, false],
    ]);
    expect(new Set(inventory.tests.map((test) => test.bodyHash)).size).toBe(2);
    expect(codes(inventory)).toEqual([]);
  });

  it('skips every test in a skipped describe, over their own todo, as Node.js creates none of them', () => {
    const inventory = scanNode(`
import { describe, it } from 'node:test';
describe.skip('desk closed', () => {
  it.todo('prices a swap');
  describe.todo('settlement', () => {
    it('nets the cash legs', () => {});
  });
});
describe.todo('desk opening', () => {
  it.skip('loads the curves', () => {});
  it('loads the positions', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.stateSource])).toEqual([
      ['desk closed > prices a swap', 'skip', 'suite'],
      ['desk closed > settlement > nets the cash legs', 'skip', 'suite'],
      ['desk opening > loads the curves', 'skip', 'test'],
      ['desk opening > loads the positions', 'todo', 'suite'],
    ]);
  });

  it('reads skip, todo and only as members and options, with a reason, skip winning over todo', () => {
    const inventory = scanNode(`
import test from 'node:test';
test.skip('streams quotes', () => {});
test('reprices a basket', { skip: 'needs the venue sandbox' }, () => {});
test('reprices bonds', { skip: !process.env.BOND_FEED }, () => {});
test('reprices futures', { skip: false }, () => {});
test('reprices options', { skip: '' }, () => {});
test('reprices swaps', { todo: 0 }, () => {});
test.todo('drops a stale quote');
test('expires a quote', { todo: true });
test.todo('rounds a quote', { skip: true }, () => {});
test.only('quotes the spread', () => {});
test('widens a quote', { only: true }, () => {});
test('quotes without a function');
const later = test.skip;
later('quotes the depth', () => {});
const onCi = process.env.CI ? test.skip : test.todo;
onCi('quotes the imbalance', () => {});
function onVenue() {
  return process.env.VENUE ? test.only : test.only.skip;
}
onVenue()('quotes the auction', () => {});
const venues = { XNAS: () => {} };
venues[process.env.VENUE]();
(() => {})();
`);
    expect(states(inventory)).toEqual([
      ['streams quotes', 'skip', null, null],
      ['reprices a basket', 'skip', 'needs the venue sandbox', null],
      ['reprices bonds', 'skip', null, '!process.env.BOND_FEED'],
      ['reprices futures', 'active', null, null],
      ['reprices options', 'skip', null, null],
      ['reprices swaps', 'todo', null, null],
      ['drops a stale quote', 'todo', null, null],
      ['expires a quote', 'todo', null, null],
      ['rounds a quote', 'skip', null, null],
      ['quotes the spread', 'active', null, null],
      ['widens a quote', 'active', null, null],
      ['quotes without a function', 'active', null, null],
      ['quotes the depth', 'skip', null, null],
      ['quotes the imbalance', 'active', null, null],
      ['quotes the auction', 'active', null, null],
    ]);
    expect(inventory.tests.filter((test) => test.isOnly).map((test) => test.title)).toEqual([
      'quotes the spread',
      'widens a quote',
      'quotes the auction',
    ]);
  });

  it('reads timeout and concurrency, and from 24.14 expectFailure, from 24.19 and 26.2 tags', () => {
    const code = `
import { describe, it, test } from 'node:test';
describe('quote book', { concurrency: true }, () => {
  it('keeps the best bid', { timeout: 2_000, tags: ['quotes'] }, () => {});
});
describe('order book', { concurrency: 1 }, () => {
  it('keeps the queue', { timeout: 'slow' }, () => {});
});
test('reprices a stale basket', { expectFailure: 'stale prices' }, () => {});
test.expectFailure('rejects a negative spread', () => {});
`;
    const rows = (version: string) =>
      scanNode(code, { frameworkVersion: version }).tests.map((test) => [
        test.title,
        test.state,
        test.reason,
        test.timeout,
        test.isParallel,
        test.tags,
      ]);
    // Before 24.14, test.expectFailure is undefined, so calling it fails the whole file.
    expect(rows('22.12.0')).toEqual([
      ['keeps the best bid', 'notLoaded', null, 2000, true, []],
      ['keeps the queue', 'notLoaded', null, null, false, []],
      ['reprices a stale basket', 'notLoaded', null, null, false, []],
      ['rejects a negative spread', 'notLoaded', null, null, false, []],
    ]);
    expect(rows('24.14.0')).toEqual([
      ['keeps the best bid', 'active', null, 2000, true, []],
      ['keeps the queue', 'active', null, null, false, []],
      ['reprices a stale basket', 'expectedToFail', null, null, false, []],
      ['rejects a negative spread', 'expectedToFail', null, null, false, []],
    ]);
    expect(rows('24.19.0')).toEqual([
      ['keeps the best bid', 'active', null, 2000, true, ['quotes']],
      ['keeps the queue', 'active', null, null, false, []],
      ['reprices a stale basket', 'expectedToFail', 'stale prices', null, false, []],
      ['rejects a negative spread', 'expectedToFail', null, null, false, []],
    ]);
    expect(rows('25.8.0')[0][5]).toEqual([]);
    expect(rows('26.2.0')[0][5]).toEqual(['quotes']);
  });

  it('names a test without a name after its function, and reads options given first', () => {
    const inventory = scanNode(`
import test from 'node:test';
test(async function settlesTrades() {});
test({ skip: true }, async function crossesRates() {});
test(() => {});
`);
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([
      ['settlesTrades', 'active'],
      ['crossesRates', 'skip'],
      ['<anonymous>', 'active'],
    ]);
  });

  it.each([
    'function checkVenue(context) { BODY }',
    'const checkVenue = (context) => { BODY };',
    'const checkVenue = function (context) { BODY };',
  ])('reads the context of a named callback: %s', (callback) => {
    const inventory = scanNode(`
import { test } from 'node:test';
${callback.replace('BODY', "context.skip('venue closed'); context.test('holds the order', () => {});")}
test('routes a market order', checkVenue);
`);
    expect(states(inventory).sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ['routes a market order', 'skip', 'venue closed', null],
      ['routes a market order > holds the order', 'active', null, null],
    ]);
    const parent = inventory.tests.find((test) => test.title === 'routes a market order');
    const child = inventory.tests.find((test) => test.title === 'holds the order');
    expect(child?.parentTestId).toBe(parent?.id);
    expect(codes(inventory)).toEqual([]);
  });

  it("reads t.skip() and t.todo() in the test's body, which mark it without stopping it", () => {
    const inventory = scanNode(`
import test from 'node:test';
test('reprices bonds', (t) => {
  if (!process.env.BOND_FEED) t.skip('no bond feed');
});
test('reprices swaps', (swaps) => {
  swaps.todo('curve not built');
});
test('reprices options', () => {
  const t = { skip() {} };
  t.skip();
});
test('reprices warrants', (t) => {
  t.diagnostic('no warrant feed');
  t.skip(process.env.WARRANT_REASON);
  assert.ok(true);
});
`);
    expect(states(inventory)).toEqual([
      ['reprices bonds', 'skip', 'no bond feed', '!process.env.BOND_FEED'],
      ['reprices swaps', 'todo', 'curve not built', null],
      ['reprices options', 'active', null, null],
      ['reprices warrants', 'skip', 'process.env.WARRANT_REASON', null],
    ]);
    expect(codes(inventory)).toEqual(['dynamic-reason']);
  });

  it("lists a test declared in a test's body as its subtest, under its title, with parentTestId", () => {
    const inventory = scanNode(`
import test, { it } from 'node:test';
test('reprices a basket', async (t) => {
  await t.test('reprices equities', async (equities) => {
    await equities.test('reprices the open', () => {});
  });
  it('reprices bonds', () => {});
});
test('reprices a closed market', { skip: 'market closed' }, async (t) => {
  await t.test('reprices futures', () => {});
});
test('reprices a holiday', async (t) => {
  t.skip('holiday');
  await t.test('reprices fx', () => {});
});
`);
    const byTitle = new Map(inventory.tests.map((test) => [test.title, test]));
    expect(inventory.tests.map((test) => [test.fullName, test.state])).toEqual([
      ['reprices a basket', 'active'],
      ['reprices a basket > reprices equities', 'active'],
      ['reprices a basket > reprices equities > reprices the open', 'active'],
      ['reprices a basket > reprices bonds', 'active'],
      ['reprices a closed market', 'skip'],
      ['reprices a closed market > reprices futures', 'skip'],
      ['reprices a holiday', 'skip'],
      ['reprices a holiday > reprices fx', 'active'],
    ]);
    expect(byTitle.get('reprices the open')?.parentTestId).toBe(byTitle.get('reprices equities')?.id);
    expect(byTitle.get('reprices equities')?.parentTestId).toBe(byTitle.get('reprices a basket')?.id);
    expect(byTitle.get('reprices a basket')?.parentTestId).toBeNull();
    expect(byTitle.get('reprices futures')?.stateSource).toBe('suite');
    expect(codes(inventory)).toEqual([]);
    const describeInTest = scanNode(
      "import test, { describe, it } from 'node:test';\ntest('reprices a basket', () => {\n  describe('bonds', () => {\n    it('reprices a bond', () => {});\n  });\n});",
    );
    expect(describeInTest.diagnostics.map((item) => item.message)).toEqual([
      'A describe declared inside a test body runs as a nested describe of the test, but the scan does not list it or its tests.',
    ]);
  });

  it('reports a chain that is not part of the API, which fails the file', () => {
    const inventory = scanNode(
      "import test from 'node:test';\ntest('quotes the spread', () => {});\ntest.concurrent('quotes the depth', () => {});",
    );
    expect(inventory.diagnostics.map((item) => item.message)).toEqual([
      "test.concurrent is not part of node:test's API; the call throws, and Node.js fails the file and runs none of its tests.",
    ]);
    expect(onlyTest(scanNode("import test from 'node:test';\ntest.skip.only('x', () => {});")).state).toBe('notLoaded');
  });
});
