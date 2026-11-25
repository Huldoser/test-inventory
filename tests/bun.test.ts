import { describe, expect, it } from 'vitest';
import type { Inventory } from '../src/index.ts';
import { codes, onlyTest, scanBun } from './helpers.ts';

function states(inventory: Inventory): [string, string, string | null][] {
  return inventory.tests.map((test) => [test.fullName, test.state, test.condition]);
}

describe('Bun tests', () => {
  it('collects Bun callback-only declarations and keeps their bodies and child tests', () => {
    const inventory = scanBun(`
function postOrder() { expect(2).toBe(2); }
test(postOrder);
describe(() => { test('fills the order', () => {}); });
test(null, () => {});
test.skip();
test.todo();
`);
    expect(inventory.tests.map((t) => [t.title, t.state, t.expectCount])).toEqual([
      ['(unnamed)', 'active', 1],
      ['fills the order', 'active', 0],
      ['(unnamed)', 'active', 0],
      ['(unnamed)', 'skip', 0],
      ['(unnamed)', 'todo', 0],
    ]);
    expect(codes(inventory)).not.toContain('internal-error');
  });

  it('marks the file as not loaded for a title Bun rejects with a separate callback', () => {
    for (const title of ['function () {}', '() => {}', 'false', '({})', '[]']) {
      const result = scanBun(`test('opens the book', () => {}); describe.skip(${title}, () => {});`);
      expect(onlyTest(result).state).toBe('notLoaded');
      expect(codes(result)).toContain('invalid-chain');
    }
  });

  it('keeps sibling Bun tests runnable when a nested declaration has an invalid title', () => {
    const result = scanBun(`
test('opens the book', () => {});
test('runs the auction', () => { test(false, () => {}); });
test('closes the book', () => {});
`);
    expect(result.tests.map((t) => [t.title, t.state])).toEqual([
      ['opens the book', 'active'],
      ['runs the auction', 'active'],
      ['closes the book', 'active'],
    ]);
    expect(codes(result)).toEqual(['nested-test']);
  });

  it('rejects an anonymous computed method as a Bun title while accepting its name string', () => {
    for (const definition of ['[key]() {}', '[key]: () => {}', '[key]: function () {}']) {
      const prefix = `const key = 'post'; const book = { ${definition} }; const post = book.post;`;
      for (const expression of ['post', 'book.post']) {
        const result = scanBun(`${prefix}
test('opens the book', () => {});
describe(${expression}, () => { test('fills the order', () => {}); });
test('closes the book', () => {});`);
        expect(result.tests.map((test) => test.state)).toEqual(['notLoaded', 'notLoaded']);
        expect(codes(result)).toContain('invalid-chain');
      }
      const named = scanBun(`${prefix} test(book.post.name, () => {});`);
      expect(onlyTest(named)).toMatchObject({ title: 'post', state: 'active', hasDynamicTitle: false });
    }
    const explicit = scanBun("const book = { ['post']: function routeOrder() {} }; test(book.post, () => {});");
    expect(onlyTest(explicit)).toMatchObject({ title: 'routeOrder', state: 'active' });
    const computedClass = scanBun(
      "const book = { ['post']: class {} }; test(book.post, () => {}); test(book.post.name, () => {});",
    );
    expect(computedClass.tests.map((test) => test.title)).toEqual(['', 'post']);
  });

  it('distinguishes missing and invalid callbacks for skipped Bun declarations', () => {
    for (const declaration of ['describe.skip()', 'describe.todo("overnight")', 'test.if(false)("overnight", null)']) {
      const result = scanBun(`test('opens the book', () => {}); ${declaration};`);
      expect(result.tests[0].state).toBe('active');
      expect(codes(result)).not.toContain('internal-error');
    }
    for (const declaration of ['test()', 'describe()', 'test.skip("overnight", 7)', 'describe.skip("overnight", {})']) {
      const result = scanBun(`test('opens the book', () => {}); ${declaration};`);
      expect(result.tests[0].state).toBe('notLoaded');
      expect(codes(result)).toContain('test-without-body');
    }
  });

  it('keeps the empty name Bun registers for an unnamed class title', () => {
    const result = scanBun('test(class {}, () => {});');
    expect(onlyTest(result)).toMatchObject({ title: '', hasDynamicTitle: false });
  });

  it('uses the declared Bun class name for the class and its static field for an explicit name property', () => {
    const result = scanBun(`class Desk { static name = "closing auction"; }
const record = function postOrder() {};
describe(Desk, () => { test(record, () => {}); });
test(Desk.name, () => {});`);
    expect(result.tests.map((t) => t.fullName)).toEqual(['Desk > postOrder', 'closing auction']);
  });

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
    ['test.todoIf(true).failing', "test.todoIf(true).failing('reprices a basket', () => {});"],
    ['test.if(false).skip', "test.if(false).skip('reprices a basket', () => {});"],
    ['test.serial.concurrentIf(true)', "test.serial.concurrentIf(true)('reprices a basket', () => {});"],
    ['test.skipIf(true).skipIf(true)', "test.skipIf(true).skipIf(true)('reprices a basket', () => {});"],
    ['test.each(5)', "test.each(5)('reprices %i', () => {});"],
  ])('reports %s, which Bun refuses, failing the file', (_, code) => {
    const inventory = scanBun(`test('quotes the spread', () => {});\n${code}`);
    expect(codes(inventory)).toEqual(['invalid-chain']);
    expect(inventory.tests[0].state).toBe('notLoaded');
  });

  it('lets the outermost skipped or todo describe decide, over the describes inside it and the test itself', () => {
    const inventory = scanBun(`
describe.skip('desk closed', () => {
  test.todo('prices a swap');
});
describe.todo('settlement', () => {
  test.skip('nets the cash legs', () => {});
});
describe.skip('margin', () => {
  describe.todo('intraday', () => {
    test('books a fee', () => {});
  });
});
describe('fx', () => {
  describe.todo('forwards', () => {
    test.skip('rolls a forward', () => {});
  });
  test.todo('books a spot');
});
`);
    // Bun 1.2.23, 1.3.14 and 1.4.4 report these states.
    expect(inventory.tests.map((test) => [test.title, test.state, test.stateSource])).toEqual([
      ['prices a swap', 'skip', 'suite'],
      ['nets the cash legs', 'todo', 'suite'],
      ['books a fee', 'skip', 'suite'],
      ['rolls a forward', 'todo', 'suite'],
      ['books a spot', 'todo', 'test'],
    ]);
  });

  it('takes a condition that does not hold, or can not be worked out, next to its mode', () => {
    const inventory = scanBun(`
test.todoIf(false).failing('reprices a basket', () => {});
test.if(true).skip('reprices bonds', () => {});
test.skipIf(process.env.CI).todo('reprices swaps', () => {});
`);
    expect(states(inventory)).toEqual([
      ['reprices a basket', 'expectedToFail', null],
      ['reprices bonds', 'skip', null],
      // When CI is set, Bun refuses skip next to todo and fails the file; otherwise the test is todo.
      ['reprices swaps', 'todo', null],
    ]);
  });

  it.each([
    ['1.2.23', ['invalid-chain', 'invalid-chain']],
    ['1.3.14', []],
  ])('refuses hooks given more than a function before Bun 1.3: %s', (version, found) => {
    const code =
      "beforeAll(() => {}, 1000);\nbeforeEach(() => {}, { timeout: 1000 });\ntest('quotes the spread', () => {});";
    expect(codes(scanBun(code, { frameworkVersion: version }))).toEqual(found);
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
    const both = "test('reprices a basket', { retry: 1, repeats: 0 }, () => {});";
    expect(codes(scanBun(both, { frameworkVersion: '1.2.23' }))).toEqual([]);
    expect(onlyTest(scanBun(both, { frameworkVersion: '1.3.14' })).state).toBe('notLoaded');
    // A retry of 0 is no retry, so repeats go with it.
    const noRetry = "test('reprices a basket', { retry: 0, repeats: 2 }, () => {});";
    expect(codes(scanBun(noRetry, { frameworkVersion: '1.3.14' }))).toEqual([]);
  });

  it('takes a function passed by name second, before options or a timeout, as Bun does', () => {
    const inventory = scanBun(`
import { settlesTrade } from './helpers.ts';
async function repricesBasket() {
  expect(await basketPrice()).toBeGreaterThan(0);
}
const slow = { timeout: 2_000 };
test('reprices a basket', repricesBasket, 5_000);
test('reprices bonds', repricesBasket, { timeout: 5_000 });
test('reprices swaps', slow, repricesBasket);
test('settles a trade', settlesTrade, 500);
test('settles a bond', slow, settlesTrade);
test.each([1, 2])('fills lot %d', repricesBasket, 500);
`);
    expect(codes(inventory)).toEqual([]);
    expect(
      inventory.tests.map((test) => [test.title, test.state, test.timeout, test.bodyHash === null ? null : 'hashed']),
    ).toEqual([
      ['reprices a basket', 'active', 5000, 'hashed'],
      ['reprices bonds', 'active', 5000, 'hashed'],
      ['reprices swaps', 'active', 2000, 'hashed'],
      ['settles a trade', 'active', 500, null],
      ['settles a bond', 'active', 2000, null],
      ['fills lot %d', 'active', 500, 'hashed'],
    ]);
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
