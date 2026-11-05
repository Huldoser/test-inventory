import { describe, expect, it } from 'vitest';
import type { Inventory } from '../src/index.ts';
import { codes, onlyTest, scanNode } from './helpers.ts';

function states(inventory: Inventory): [string, string, string | null, string | null][] {
  return inventory.tests.map((test) => [test.fullName, test.state, test.reason, test.condition]);
}

describe('node:test tests', () => {
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

  it('reads skip, todo and only as members and options, with a reason, skip winning over todo', () => {
    const inventory = scanNode(`
import test from 'node:test';
test.skip('streams quotes', () => {});
test('reprices a basket', { skip: 'needs the venue sandbox' }, () => {});
test('reprices bonds', { skip: !process.env.BOND_FEED }, () => {});
test('reprices futures', { skip: false }, () => {});
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
