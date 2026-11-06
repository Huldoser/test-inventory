import { describe, expect, it } from 'vitest';
import type { Inventory } from '../src/index.ts';
import { codes, onlyTest, scanJasmine, testNamed } from './helpers.ts';

function states(inventory: Inventory): [string, string, boolean][] {
  return inventory.tests.map((test) => [test.fullName, test.state, test.isOnly]);
}

describe('Jasmine globals', () => {
  it('reads describe and it with their x and f forms, a spec without a function as pending, and a timeout', () => {
    const inventory = scanJasmine(`
describe('order ticket', () => {
  it('places a market order', () => {});
  it('places a limit order');
  xit('places a stop order', () => {});
  xit('replaces an order');
  fit('amends an order', () => {});
  it('cancels an order', () => {}, 250);
  describe('blotter', () => {
    it('lists fills', () => {});
  });
});
xdescribe('watchlist', () => {
  it('adds a symbol', () => {});
});
fdescribe('quotes', () => {
  it('reprices a quote', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['order ticket > places a market order', 'active', false],
      ['order ticket > places a limit order', 'skip', false],
      ['order ticket > places a stop order', 'skip', false],
      ['order ticket > replaces an order', 'skip', false],
      ['order ticket > amends an order', 'active', true],
      ['order ticket > cancels an order', 'active', false],
      ['order ticket > blotter > lists fills', 'active', false],
      ['watchlist > adds a symbol', 'skip', false],
      ['quotes > reprices a quote', 'active', true],
    ]);
    expect(testNamed(inventory, 'cancels an order').timeout).toBe(250);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('counts the hooks, and reports a file that imports another runner', () => {
    const inventory = scanJasmine(`
import { test } from '@playwright/test';
describe('custodian', () => {
  beforeAll(() => {});
  beforeEach(() => {}, 10_000);
  afterEach(() => {});
  afterAll(() => {});
  it('sends an instruction', () => {});
});
`);
    expect(onlyTest(inventory).hooks).toMatchObject({ beforeAll: 1, beforeEach: 1, afterEach: 1, afterAll: 1 });
    expect(codes(inventory)).toEqual(['framework-mismatch']);
  });

  it('keeps the x or f of a variable that holds xit, fit, xdescribe or fdescribe', () => {
    const inventory = scanJasmine(`
const later = xit;
const dark = xdescribe;
const now = fit;
dark('dark pool', () => {
  it('matches at the midpoint', () => {});
});
describe('lit book', () => {
  later('crosses the spread', () => {});
  now('reprices a pegged order', () => {});
  it('rests a limit order', () => {});
});
`);
    // Jasmine 4.6.0 to 7.0.0: both specs under xit and xdescribe are pending, and the fit is the only one that runs.
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.isOnly])).toEqual([
      ['dark pool > matches at the midpoint', 'skip', false],
      ['lit book > crosses the spread', 'skip', false],
      ['lit book > reprices a pegged order', 'active', true],
      ['lit book > rests a limit order', 'active', false],
    ]);
  });
});

describe('Jasmine specs marked pending at run time', () => {
  it('reads pending() in a spec or its beforeEach or afterEach, with its reason, not in beforeAll or a local function', () => {
    const inventory = scanJasmine(`
describe('fx rates', () => {
  it('converts EUR to USD', () => {
    pending('FX-31: the rates feed is down');
  });
  it('converts GBP to USD', () => {
    if (!process.env.RATES_URL) pending();
  });
  describe('crosses', () => {
    beforeEach(() => {
      pending('FX-40: crosses are not built');
    });
    it('converts EUR to GBP', () => {});
  });
  describe('history', () => {
    afterEach(() => {
      pending('FX-52: history is rebuilt nightly');
    });
    it('reads yesterday\\'s close', () => {});
  });
  describe('forwards', () => {
    beforeAll(() => {
      pending('the forward curve is not loaded');
    });
    it('prices a 3-month forward', () => {});
  });
  it('rounds to the pip', () => {
    const pending = () => {};
    pending('not the global');
  });
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.isConditional, test.reason])).toEqual([
      ['fx rates > converts EUR to USD', 'skip', false, 'FX-31: the rates feed is down'],
      ['fx rates > converts GBP to USD', 'skip', true, null],
      ['fx rates > crosses > converts EUR to GBP', 'skip', false, 'FX-40: crosses are not built'],
      ["fx rates > history > reads yesterday's close", 'skip', false, 'FX-52: history is rebuilt nightly'],
      ['fx rates > forwards > prices a 3-month forward', 'active', false, null],
      ['fx rates > rounds to the pip', 'active', false, null],
    ]);
  });

  it.each([
    ['6.3.0', 'active'],
    ['7.0.0', 'skip'],
  ])('reads notApplicable() from Jasmine 7, and before as a call that fails the spec: %s', (version, state) => {
    const inventory = scanJasmine(
      "describe('margin', () => {\n  it('calls margin', () => {\n    notApplicable('cash account');\n  });\n});\n",
      { frameworkVersion: version },
    );
    expect(onlyTest(inventory).state).toBe(state);
  });
});

describe('Jasmine focus and specs it registers as written', () => {
  it('runs the innermost focus, also inside an xdescribe, as Jasmine 4.6 and 7.0 do', () => {
    const inventory = scanJasmine(`
xdescribe('limits', () => {
  fit('caps notional', () => {});
  it('caps leverage', () => {});
  fdescribe('intraday', () => {
    it('caps open orders', () => {});
  });
});
fdescribe('greeks', () => {
  fit('sums the delta', () => {});
  it('sums the gamma', () => {});
});
fdescribe('scenarios', () => {
  it('replays a rate shock', () => {});
  describe('credit', () => {
    fit('widens spreads', () => {});
  });
});
fdescribe('hedges', () => {
  xit('rolls futures', () => {});
  it('buys puts', () => {});
  xdescribe('collars', () => {
    it('sells a call', () => {});
  });
});
describe('reports', () => {
  it('prints exposure', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['limits > caps notional', 'active', true],
      ['limits > caps leverage', 'skip', false],
      ['limits > intraday > caps open orders', 'active', true],
      ['greeks > sums the delta', 'active', true],
      ['greeks > sums the gamma', 'active', false],
      ['scenarios > replays a rate shock', 'active', false],
      ['scenarios > credit > widens spreads', 'active', true],
      ['hedges > rolls futures', 'skip', true],
      ['hedges > buys puts', 'active', true],
      // A focus around an xdescribe doesn't run it; only one inside it does.
      ['hedges > collars > sells a call', 'skip', true],
      ['reports > prints exposure', 'active', false],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads it() as a pending spec titled empty, undefined as no function, and nothing from spread arguments', () => {
    const inventory = scanJasmine(`
const CASES = [['sums the vega', () => {}, 5000]];
describe('greeks', () => {
  it();
  it('sums the theta', undefined);
  it(...CASES[0]);
  it('sums the rho', ...[() => {}], 5000);
});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.timeout])).toEqual([
      ['', 'skip', null],
      ['sums the theta', 'skip', null],
      ['...CASES[0]', 'active', null],
      ['sums the rho', 'active', null],
    ]);
  });

  it('reports a describe that declares nothing, which Jasmine refuses, but not one that calls a helper', () => {
    const inventory = scanJasmine(`
describe('stress tests', () => {
  beforeEach(() => {});
});
xdescribe('scenarios', () => {});
describe('limits', () => {
  defineLimitSpecs('rates');
});
describe('margin', () => it('calls margin', () => {}));
describe('collateral', () => {
  'use strict';
  const haircuts = HAIRCUTS;
  it('applies the haircut', () => {});
});
describe(...SUITES.netting);
`);
    expect(inventory.diagnostics.map((item) => [item.code, item.lineStart])).toEqual([
      ['describe-throws', 2],
      ['describe-throws', 5],
      ['dynamic-title', 15],
    ]);
  });
});

describe('Jasmine calls the scan reads in part', () => {
  it('warns about a timeout or reason it cannot work out, and reads nothing from computed or chained names', () => {
    const inventory = scanJasmine(`
const focused = it.only;
describe('stress tests', () => {
  it('replays the 2008 shock', () => {}, Number(process.env.STRESS_TIMEOUT));
  it('replays the 2020 shock', () => {
    pending(reasonFor('2020'));
  });
  specs[process.env.KIND]('replays a custom shock', () => {});
  focused('replays the 1987 shock', () => {});
  it('replays the 2022 shock', () => {
    fit('nested shock');
    describe('nested scenarios');
  });
});
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.timeout])).toEqual([
      ['stress tests > replays the 2008 shock', 'active', null],
      ['stress tests > replays the 2020 shock', 'skip', null],
      ['stress tests > replays the 2022 shock', 'active', null],
    ]);
    expect(codes(inventory)).toEqual(['unresolved-option', 'dynamic-reason', 'nested-test', 'nested-test']);
  });
});

describe('declarations Jasmine refuses', () => {
  it("counts a describe callback's arguments by its length, as Jasmine does: not TypeScript's this, a default or a rest", () => {
    const inventory = scanJasmine(`
describe('order router', function (this: object) {
  it('routes a market order', () => {});
});
describe('smart routing', (venues = ['XNAS']) => {
  it('splits across venues', () => {});
});
describe('dark pools', (...pools) => {
  it('matches at the midpoint', () => {});
});
`);
    expect(inventory.tests.map((test) => test.state)).toEqual(['active', 'active', 'active']);
    expect(codes(inventory)).toEqual([]);
  });

  it('reports those at the top level of a file, which stop the whole run, and lists the tests as not loaded', () => {
    const inventory = scanJasmine(`
describe('settlement', () => {
  it('books the cash leg', () => {});
});
it.only('books the securities leg', () => {});
describe('buy-ins');
xdescribe('fails');
fit('nets two fills');
describe('custody', async () => {});
describe('calendar', (done) => {
  it('skips exchange holidays', () => {});
});
describe();
`);
    expect(inventory.diagnostics.map((item) => [item.code, item.lineStart, item.message])).toEqual([
      ['invalid-chain', 5, "it.only is not part of Jasmine's API, so Jasmine stops before it runs any spec."],
      ['test-without-body', 6, 'describe() has no function, so Jasmine stops before it runs any spec.'],
      ['test-without-body', 7, 'xdescribe() has no function, so Jasmine stops before it runs any spec.'],
      ['test-without-body', 8, 'fit() has no function, so Jasmine stops before it runs any spec.'],
      [
        'async-describe',
        9,
        'The describe callback is async, which Jasmine refuses, so Jasmine stops before it runs any spec.',
      ],
      [
        'describe-throws',
        10,
        'The describe callback takes arguments, which Jasmine refuses, so Jasmine stops before it runs any spec.',
      ],
      ['test-without-body', 13, 'describe() has no function, so Jasmine stops before it runs any spec.'],
    ]);
    expect(testNamed(inventory, 'books the cash leg').state).toBe('notLoaded');
  });

  it('reports those inside a describe, which Jasmine catches, without stopping the run', () => {
    const inventory = scanJasmine(`
describe('fees', () => {
  it('charges the minimum fee', () => {});
  it('charges a percentage', 42);
});
describe('quotes', () => {
  it('reprices a quote', () => {});
});
`);
    expect(inventory.diagnostics.map((item) => [item.code, item.level, item.message])).toEqual([
      [
        'test-without-body',
        'error',
        'it() takes a function second, so the describe around it throws: Jasmine reports it as failed, and registers none of the specs written after this call in it.',
      ],
    ]);
    expect(states(inventory)).toEqual([
      ['fees > charges the minimum fee', 'active', false],
      ['quotes > reprices a quote', 'active', false],
    ]);
  });
});
