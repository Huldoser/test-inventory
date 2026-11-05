import { describe, expect, it } from 'vitest';
import type { Inventory } from '../src/index.ts';
import { codes, onlyTest, scanBun } from './helpers.ts';

function states(inventory: Inventory): [string, string, string | null][] {
  return inventory.tests.map((test) => [test.fullName, test.state, test.condition]);
}

describe('Bun tests', () => {
  it('reads its globals, bun:test imported any way, and @jest/globals and vitest imports, which Bun rewrites', () => {
    const inventory = scanBun(`
import * as bt from 'bun:test';
import { it as vitestIt } from 'vitest';
import { test as jestTest } from '@jest/globals';
const { describe: bunDescribe } = require('bun:test');
test('quotes the spread', () => {});
bt.test.skip('quotes the depth', () => {});
vitestIt('quotes the imbalance', () => {});
jestTest('quotes the auction', () => {});
bunDescribe('order book', () => {
  xit('keeps the queue', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['quotes the spread', 'active', null],
      ['quotes the depth', 'skip', null],
      ['quotes the imbalance', 'active', null],
      ['quotes the auction', 'active', null],
      ['order book > keeps the queue', 'skip', null],
    ]);
    expect(codes(inventory)).toEqual([]);
  });

  it('reads modes and conditions in any order, skip winning over todo and todo over failing', () => {
    const inventory = scanBun(`
test.todo('reprices a basket');
test.todo('reprices bonds', () => {});
test.failing('rejects a negative spread', () => {});
test.if(process.env.VENUE_URL)('streams quotes', () => {});
test.skipIf(process.platform === 'win32')('watches the feed', () => {});
test.todoIf(true)('routes to a dark pool', () => {});
test.failingIf(!process.env.FIXED)('rounds a quote', () => {});
test.if(false)('streams depth', () => {});
test.skipIf(false).todo('reprices swaps', () => {});
test.failing.only('reprices options', () => {});
test.only.skip('reprices warrants', () => {});
test.concurrent('quotes in parallel', () => {});
describe.serial('settlement', () => {
  test.concurrentIf(true)('settles a trade', () => {});
});
`);
    expect(
      inventory.tests.map((test) => [test.title, test.state, test.condition, test.isOnly, test.isParallel]),
    ).toEqual([
      ['reprices a basket', 'todo', null, false, false],
      ['reprices bonds', 'todo', null, false, false],
      ['rejects a negative spread', 'expectedToFail', null, false, false],
      ['streams quotes', 'skip', '!(process.env.VENUE_URL)', false, false],
      ['watches the feed', 'skip', "process.platform === 'win32'", false, false],
      ['routes to a dark pool', 'todo', null, false, false],
      ['rounds a quote', 'expectedToFail', '!process.env.FIXED', false, false],
      ['streams depth', 'skip', null, false, false],
      ['reprices swaps', 'todo', null, false, false],
      ['reprices options', 'expectedToFail', null, true, false],
      ['reprices warrants', 'skip', null, true, false],
      ['quotes in parallel', 'active', null, false, true],
      ['settles a trade', 'active', null, false, true],
    ]);
  });

  it.each([
    ['test.skip.failing', "test.skip.failing('reprices a basket', () => {});"],
    ['test.only.only', "test.only.only('reprices a basket', () => {});"],
    ['test.concurrent.serial', "test.concurrent.serial('reprices a basket', () => {});"],
    ['test.each(table).each', "test.each([[1]]).each([[2]])('reprices %i', () => {});"],
    ['describe.failing', "describe.failing('basket', () => { test('reprices', () => {}); });"],
    ['describe.failingIf(true)', "describe.failingIf(true)('basket', () => { test('reprices', () => {}); });"],
    ['test.concurrent', "test.concurrent.foo('reprices a basket', () => {});"],
  ])('reports %s, which Bun refuses, failing the file', (_, code) => {
    const inventory = scanBun(`test('quotes the spread', () => {});\n${code}`);
    expect(codes(inventory)).toEqual(['invalid-chain']);
    expect(inventory.tests[0].state).toBe('notLoaded');
  });

  it('reads options second or third, a number as the timeout, and refuses retry with repeats from 1.3', () => {
    const inventory = scanBun(`
test('reprices a basket', { timeout: 2_000, retry: 2 }, () => {});
test('reprices bonds', () => {}, { repeats: 3 });
test('reprices swaps', () => {}, 500);
`);
    expect(inventory.tests.map((test) => [test.title, test.timeout, test.retries, test.repeats])).toEqual([
      ['reprices a basket', 2000, 2, null],
      ['reprices bonds', null, null, 3],
      ['reprices swaps', 500, null, null],
    ]);
    const both = "test('reprices a basket', { retry: 1, repeats: 2 }, () => {});";
    expect(codes(scanBun(both, { frameworkVersion: '1.2.23' }))).toEqual([]);
    expect(onlyTest(scanBun(both, { frameworkVersion: '1.3.14' })).state).toBe('notLoaded');
  });

  it('refuses a test or describe without a function, unless it is skipped or todo', () => {
    expect(codes(scanBun("test.skip('streams quotes');\ntest.todo('drops a stale quote');"))).toEqual([]);
    // In a test's body, Bun refuses it when the test runs, so it is a nested test only.
    expect(codes(scanBun("test('quotes the spread', () => {\n  test('streams quotes');\n});"))).toEqual([
      'nested-test',
    ]);
    for (const code of [
      "test('streams quotes');",
      "test.only('streams quotes');",
      "describe('quote book');",
      "test('streams quotes', { timeout: 5_000 });",
    ]) {
      expect(codes(scanBun(`test('quotes the spread', () => {});\n${code}`))).toEqual(['test-without-body']);
    }
  });

  it('reads the rarer forms: required aliases, spread arguments, tables it cannot work out, and refused calls', () => {
    const inventory = scanBun(`
const { test: jestTest } = require('@jest/globals');
const later = process.env.CI ? test.skip : test.todo;
const table = test.each;
jestTest('quotes the auction', () => {});
later('quotes the close', () => {});
function onVenue() {
  return process.env.VENUE ? test.only : test.only.skip;
}
onVenue()('quotes the halt', () => {});
test[process.env.MODE]('quotes the open', () => {});
test.skip(\`quotes \${process.env.MIC}\`, () => {});
test(...process.env.ARGS);
test('quotes the depth', () => {}, -1);
test.each(loadVenues())('quotes %s', () => {});
test.each('quotes the open', () => {});
test.each()('quotes the close %s', () => {});
test.each(...process.env.ROWS)('quotes the auction %s', () => {});
test.each([['XNAS']])(\`quotes \${process.env.SIDE} %s\`, () => {});
test.if(true).skip.failingIf(process.env.CROSSED)('prices a crossed quote', () => {});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.caseCount])).toEqual([
      ['quotes the auction', 'active', null],
      ['quotes the close', 'active', null],
      ['quotes the halt', 'active', null],
      ['`quotes ${process.env.MIC}`', 'skip', null],
      ['...process.env.ARGS', 'active', null],
      ['quotes the depth', 'active', null],
      ['quotes %s', 'active', null],
      ['quotes the close %s', 'active', null],
      ['quotes the auction %s', 'active', null],
      ['`quotes ${process.env.SIDE} %s`', 'active', 1],
      ['prices a crossed quote', 'skip', null],
    ]);
    expect(codes(inventory)).toEqual([
      'dynamic-title',
      'dynamic-title',
      'unresolved-option',
      'unresolved-cases',
      'unresolved-cases',
      'dynamic-title',
    ]);
    expect(codes(scanBun("test('quotes the spread', () => {});\ntest.only()('quotes the depth', () => {});"))).toEqual([
      'invalid-chain',
    ]);
  });

  it.each([
    ['1.2.23', ['quotes XNAS for "rates"', 'quotes XLON for "fx"']],
    ['1.3.14', ['quotes XNAS for rates', 'quotes XLON for fx']],
  ])('titles each case as Bun %s does', (version, titles) => {
    const inventory = scanBun(
      `test.each([{ mic: 'XNAS', desk: { name: 'rates' } }, { mic: 'XLON', desk: { name: 'fx' } }])('quotes %s for $desk.name', () => {});`,
      { frameworkVersion: version, expandCases: true },
    );
    // `%s` meets the row, an object, so it stays as written; the scan shows it as the title has it.
    expect(inventory.tests.map((test) => test.title)).toEqual(titles.map((title) => title.replace(/X\w+/, '%s')));
  });
});
