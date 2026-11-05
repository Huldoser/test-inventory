import { describe, expect, it } from 'vitest';
import type { Inventory } from '../src/index.ts';
import { codes, onlyTest, scanMocha, testNamed } from './helpers.ts';

function states(inventory: Inventory): [string, string, boolean][] {
  return inventory.tests.map((test) => [test.fullName, test.state, test.isOnly]);
}

describe('Mocha globals and imports', () => {
  it('reads the BDD globals, their skip and only forms, and a test without a function as pending', () => {
    const inventory = scanMocha(`
describe('order ticket', () => {
  it('places a market order', () => {});
  specify('places a limit order', () => {});
  it('places a stop order');
  it.skip('amends an order', () => {});
  xit('cancels an order', () => {});
  xspecify('replaces an order', () => {});
  it.only('fills an order', () => {});
  context('blotter', () => {
    it('lists fills', () => {});
  });
});
xdescribe('watchlist', () => {
  it('adds a symbol', () => {});
});
xcontext('alerts', () => {
  it('fires on a price cross', () => {});
});
describe.skip('margin', () => {
  it('calls margin', () => {});
});
describe.only('fees', () => {
  it('charges the minimum fee', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['order ticket > places a market order', 'active', false],
      ['order ticket > places a limit order', 'active', false],
      ['order ticket > places a stop order', 'skip', false],
      ['order ticket > amends an order', 'skip', false],
      ['order ticket > cancels an order', 'skip', false],
      ['order ticket > replaces an order', 'skip', false],
      ['order ticket > fills an order', 'active', true],
      ['order ticket > blotter > lists fills', 'active', false],
      ['watchlist > adds a symbol', 'skip', false],
      ['alerts > fires on a price cross', 'skip', false],
      ['margin > calls margin', 'skip', false],
      ['fees > charges the minimum fee', 'active', true],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads tests and hooks imported from mocha, also through require() and the whole module', () => {
    const inventory = scanMocha(`
import { describe as group, it as check, before as setUp } from 'mocha';
import * as mocha from 'mocha';
const { xit: later } = require('mocha');
group('settlement', () => {
  setUp(() => {});
  check('books the cash leg', () => {});
  mocha.it.skip('books the securities leg', () => {});
  later('nets two fills', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['settlement > books the cash leg', 'active', false],
      ['settlement > books the securities leg', 'skip', false],
      ['settlement > nets two fills', 'skip', false],
    ]);
    expect(inventory.suites[0].hooks).toMatchObject({ beforeAll: 1, beforeEach: 0 });
  });

  it('counts before and after as the hooks around all tests, and beforeEach and afterEach around each', () => {
    const inventory = scanMocha(`
describe('custodian', () => {
  before('connects to the custodian', () => {});
  after(() => {});
  beforeEach(function () {});
  afterEach(() => {});
  it('sends an instruction', () => {});
});
`);
    expect(inventory.suites[0].hooks).toMatchObject({ beforeAll: 1, afterAll: 1, beforeEach: 1, afterEach: 1 });
    expect(onlyTest(inventory).hooks).toMatchObject({ beforeAll: 1, afterAll: 1, beforeEach: 1, afterEach: 1 });
  });

  it('reports a file that imports another runner', () => {
    const inventory = scanMocha(`
import { test } from 'vitest';
describe('quotes', () => {
  it('reprices a stale quote', () => {});
});
`);
    expect(codes(inventory)).toEqual(['framework-mismatch']);
  });
});

describe('Mocha timeouts and retries', () => {
  it('reads this.timeout() and this.retries() in a describe written as a function, for its tests', () => {
    const inventory = scanMocha(`
describe('exchange gateway', function () {
  this.timeout(10_000);
  this.retries(2);
  it('logs on', () => {});
  describe('heartbeats', function () {
    this.timeout('30s');
    it('answers a test request', () => {});
  });
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.timeout, test.retries])).toEqual([
      ['exchange gateway > logs on', 10_000, 2],
      ['exchange gateway > heartbeats > answers a test request', 30_000, 2],
    ]);
  });

  it("reads a test's own this.timeout() and this.retries(), and those chained after it() and describe()", () => {
    const inventory = scanMocha(`
describe('order router', () => {
  it('routes to the cheapest venue', function () {
    this.timeout(500);
    this.retries(1);
  });
  it('routes an iceberg order', () => {}).timeout('2s').retries(3);
  describe('dark pools', () => {
    it('routes a block trade', () => {});
  }).timeout(60_000);
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.timeout, test.retries])).toEqual([
      ['order router > routes to the cheapest venue', 500, 1],
      ['order router > routes an iceberg order', 2000, 3],
      ['order router > dark pools > routes a block trade', 60_000, null],
    ]);
  });

  it("leaves out this.timeout() where this isn't Mocha's: an arrow function, or a hook's own timeout", () => {
    const inventory = scanMocha(`
describe('positions', () => {
  beforeEach(function () {
    this.timeout(5000);
  });
  it('nets a long and a short', () => {});
});
`);
    expect(onlyTest(inventory).timeout).toBeNull();
    expect(inventory.diagnostics).toEqual([]);
  });

  it('warns about a timeout that is not a duration, and leaves it out', () => {
    const inventory = scanMocha(`
describe('fx rates', function () {
  this.timeout(process.env.RATES_TIMEOUT);
  it('converts EUR to USD', () => {});
});
`);
    expect(onlyTest(inventory).timeout).toBeNull();
    expect(inventory.diagnostics.map((item) => [item.code, item.message])).toEqual([
      ['unresolved-option', 'The timeout process.env.RATES_TIMEOUT could not be worked out; it is not applied.'],
    ]);
  });
});

describe("Mocha's this, and calls that only look like settings", () => {
  it("reads nothing from this where it isn't Mocha's, a getter, or a setting the records don't hold", () => {
    const inventory = scanMocha(`
describe('trade capture', () => {
  this.timeout(5000);
  it('captures a fill', function () {
    if (this.timeout() < 1000) this.slow(200);
  });
});
describe('allocations', function () {
  this.skip();
  this.slow(1000);
  it('allocates a block to accounts', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.timeout])).toEqual([
      ['trade capture > captures a fill', 'active', null],
      ['allocations > allocates a block to accounts', 'active', null],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads .timeout() only after a test or describe call, and keeps the test when its value is unknown', () => {
    const inventory = scanMocha(`
const request = require('supertest');
const app = require('../src/app');
describe('order api', () => {
  it('lists open orders', async () => {
    await request(app).get('/orders').timeout(500);
  });
  const amend = it('amends an order', () => {});
  amend.timeout(250);
  it('cancels an order', () => {}).timeout(process.env.CANCEL_TIMEOUT);
  it('fills an order', () => {}).retries();
  handlers[process.env.MODE]('replaces an order');
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.timeout, test.retries])).toEqual([
      ['order api > lists open orders', null, null],
      ['order api > amends an order', null, null],
      ['order api > cancels an order', null, null],
      ['order api > fills an order', null, null],
    ]);
    expect(codes(inventory)).toEqual(['unresolved-option']);
  });

  it.each([
    ["this.timeout('3000')", 3000, null, []],
    ['this.timeout(2.5)', null, null, ['unresolved-option']],
    ["this.timeout('soon')", null, null, ['unresolved-option']],
    ['this.timeout(true)', null, null, ['unresolved-option']],
    ["this.retries('2')", null, null, ['unresolved-option']],
    ['this.retries(...RETRIES)', null, null, ['unresolved-option']],
  ])('reads %s as Mocha does', (call, timeout, retries, found) => {
    const inventory = scanMocha(`describe('blotter', function () {\n  ${call};\n  it('lists fills', () => {});\n});\n`);
    expect([onlyTest(inventory).timeout, onlyTest(inventory).retries]).toEqual([timeout, retries]);
    expect(codes(inventory)).toEqual(found);
  });

  it('reads a test function kept in a variable, with its skip', () => {
    const inventory = scanMocha(`
const pending = it.skip;
describe('corporate actions', () => {
  pending('applies a spin-off', () => {});
});
`);
    expect(onlyTest(inventory).state).toBe('skip');
  });
});

describe('Mocha settings as each version applies them', () => {
  it.each([
    ['10.8.2', null],
    ['12.0.3', 7000],
  ])(
    "applies describe(...).timeout() to the describe's tests from Mocha 12, and .retries() never: %s",
    (version, timeout) => {
      const inventory = scanMocha(
        "describe('order book', () => {\n  it('matches two orders', () => {});\n}).timeout(7000).retries(3);\n",
        { frameworkVersion: version },
      );
      expect([onlyTest(inventory).timeout, onlyTest(inventory).retries]).toEqual([timeout, null]);
    },
  );

  it("reads this only in the test's own function, and not this.skip() in an after hook, which Mocha refuses", () => {
    const inventory = scanMocha(`
describe('margin calls', () => {
  it('sends a margin call', function () {
    [1].forEach(function () {
      this.timeout(4000);
    });
  });
  it('liquidates a position', function () {
    function check() {
      this.skip();
    }
    check.call({ skip() {} });
  });
  describe('end of day', () => {
    after(function () {
      this.skip();
    });
    it('sweeps the cash', () => {});
  });
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.timeout])).toEqual([
      ['margin calls > sends a margin call', 'active', null],
      ['margin calls > liquidates a position', 'active', null],
      ['margin calls > end of day > sweeps the cash', 'active', null],
    ]);
  });

  it.each([
    ['this.timeout(0)', 0],
    ['this.timeout(-1)', 0],
    ['this.timeout(3e9)', 0],
    ["this.timeout('25d')", 0],
  ])('reads %s as no timeout, as Mocha clamps it', (call, timeout) => {
    const inventory = scanMocha(`describe('blotter', function () {\n  ${call};\n  it('lists fills', () => {});\n});\n`);
    expect(onlyTest(inventory).timeout).toBe(timeout);
    expect(codes(inventory)).toEqual([]);
  });
});

describe('Mocha skips at run time', () => {
  it('reads this.skip() in a test or a hook written as a function as skipping the tests it runs for', () => {
    const inventory = scanMocha(`
describe('corporate actions', () => {
  it('applies a stock split', function () {
    this.skip();
  });
  it('applies a dividend', () => {});
  describe('mergers', () => {
    before(function () {
      this.skip();
    });
    it('converts the shares', () => {});
  });
});
`);
    expect(states(inventory)).toEqual([
      ['corporate actions > applies a stock split', 'skip', false],
      ['corporate actions > applies a dividend', 'active', false],
      ['corporate actions > mergers > converts the shares', 'skip', false],
    ]);
    expect(testNamed(inventory, 'applies a stock split').stateSource).toBe('test');
  });
});

describe('declarations Mocha refuses', () => {
  it('reports a describe without a function, which stops the whole run, but not a skipped one', () => {
    const inventory = scanMocha(`
describe('settlement', () => {
  it('books the cash leg', () => {});
});
describe('buy-ins');
describe.skip('fails');
`);
    expect(inventory.diagnostics.map((item) => [item.code, item.lineStart, item.message])).toEqual([
      ['test-without-body', 5, 'describe() has no function, so Mocha stops before it runs any test.'],
    ]);
    expect(onlyTest(inventory).state).toBe('notLoaded');
  });

  it('reports it() and describe() without a title, which stop the whole run, and a describe without a function in a test as nested', () => {
    const inventory = scanMocha(`
describe('settlement', () => {
  it('books the cash leg', () => {
    describe('buy-ins');
  });
  it();
});
describe();
`);
    expect(inventory.diagnostics.map((item) => [item.code, item.lineStart, item.message])).toEqual([
      [
        'nested-test',
        4,
        'A test or describe declared inside a test or hook body is not collected by the runner, so it is not listed.',
      ],
      ['test-without-body', 6, 'it() has no title, so Mocha stops before it runs any test.'],
      ['test-without-body', 8, 'describe() has no title, so Mocha stops before it runs any test.'],
    ]);
    expect(onlyTest(inventory).state).toBe('notLoaded');
  });

  it('reports a chain that is not part of the API, and lists the test it declares as not loaded', () => {
    const inventory = scanMocha(
      "it.concurrent('routes an order', () => {});\nit.only.skip('routes a block', () => {});",
    );
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([
      ['routes an order', 'notLoaded'],
      ['routes a block', 'notLoaded'],
    ]);
    expect(codes(inventory)).toEqual(['invalid-chain', 'invalid-chain']);
  });
});
