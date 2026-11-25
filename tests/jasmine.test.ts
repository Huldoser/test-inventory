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

  it('reads pending Jasmine specs and the timeout following a spread callback', () => {
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
      ['sums the rho', 'active', 5000],
    ]);
  });

  it('applies the empty suite rule for the installed Jasmine version and suite form', () => {
    for (const [frameworkVersion, refused] of [
      ['3.99.1', []],
      ['4.0.0', ['describe']],
      ['4.4.0', ['describe']],
      ['4.5.0', ['describe', 'xdescribe', 'fdescribe']],
      ['7.0.2', ['describe', 'xdescribe', 'fdescribe']],
    ] as const) {
      for (const api of ['describe', 'xdescribe', 'fdescribe']) {
        const scan = scanJasmine(
          `const group = ${api}; group('closing auction', () => { beforeEach(() => {}); }); it('settles', () => {});`,
          { frameworkVersion },
        );
        expect(codes(scan), `${frameworkVersion} ${api}`).toEqual(
          refused.some((name) => name === api) ? ['describe-throws'] : [],
        );
      }
    }
  });

  it('marks a file not loaded when its suite body cannot register a child', () => {
    for (const body of [
      "if (false) it('routes a trade', () => {});",
      "const marketOpen = false; if (marketOpen) it('routes a trade', () => {});",
      "if (true) { if (0) it('routes a trade', () => {}); } else { it('routes an order', () => {}); }",
      "function registerTrades() { it('routes a trade', () => {}); }",
      "'use strict'; ; { beforeEach(() => {}); }",
      "const book = { prepare: () => it('routes a trade', () => {}) };",
      "const callbacks = [() => it('routes a trade', () => {})];",
      "{ return; } it('routes a trade', () => {});",
      'function openMarket() {} beforeEach(openMarket, 250);',
      'let quote; const rows = [, 12];',
      'return 7;',
    ]) {
      const scan = scanJasmine(`describe('closing auction', () => { ${body} }); it('settles', () => {});`);
      expect(testNamed(scan, 'settles').state, body).toBe('notLoaded');
      expect(codes(scan), body).toContain('describe-throws');
    }
  });

  it('keeps the file loaded when evaluating a suite might register a spec or throw', () => {
    for (const body of [
      "function registerTrades() { it('routes a trade', () => {}); } registerTrades();",
      "const book = { ready: it('routes a trade', () => {}) };",
      "const rows = [it('routes a trade', () => {})];",
      "const book = { [it('routes a trade', () => {})]: 1 };",
      "beforeEach((it('routes a trade', () => {}), () => {}));",
      "function beforeEach(fn) { it('routes a trade', fn); } beforeEach(() => {});",
      "const open = false; { const open = true; if (open) it('routes a trade', () => {}); }",
      "if (open) it('routes a trade', () => {}); const open = false;",
      "return it('routes a trade', () => {});",
      "throw Error('feed unavailable');",
      'beforeEach(42);',
      'beforeEach(function* staleQuotes() {});',
      'beforeEach(() => {}, 2147483648);',
      'beforeEach(() => {}, getTimeout());',
      "beforeEach(() => {}, 25, it('routes a trade', () => {}));",
      'const { price } = getQuote();',
      'const quotes = [...openQuotes];',
      'const book = { ...closingPrices };',
      "if (market.isOpen) it('routes a trade', () => {});",
    ]) {
      const scan = scanJasmine(`describe('closing auction', () => { ${body} }); it('settles', () => {});`);
      expect(testNamed(scan, 'settles').state, body).toBe('active');
    }
  });

  it('checks the definition scope and parameter evaluation of a named Jasmine callback', () => {
    const deferred = scanJasmine(`
function registerTrades(option = it('routes a trade', () => {})) {}
describe('orders', registerTrades);
it('settles', () => {});
`);
    expect(testNamed(deferred, 'settles').state).toBe('active');
    const simple = scanJasmine(
      "describe('orders', (open = false) => beforeEach(() => {}, 25)); it('settles', () => {});",
    );
    expect(testNamed(simple, 'settles').state).toBe('notLoaded');
  });

  it('accepts an unused callback argument on a skipped or focused Jasmine suite', () => {
    for (const api of ['xdescribe', 'fdescribe']) {
      const result = scanJasmine(`${api}('closing auction', (venue) => {it('fills the order', () => {});});`);
      expect(codes(result), api).toEqual([]);
      expect(onlyTest(result).state).toBe(api === 'xdescribe' ? 'skip' : 'active');
    }
    const plain = scanJasmine("describe('closing auction', (venue) => {});");
    expect(plain.diagnostics[0].message).toContain('takes arguments');
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
  it('normalizes primitive Jasmine descriptions separately for specs and suites', () => {
    for (const [source, suiteName, specName] of [
      ['false', 'false', ''],
      ['0', '0', ''],
      ['null', '', ''],
      ['undefined', '', ''],
      ['true', 'true', 'true'],
      ['-7', '-7', '-7'],
      ['0n', '0', ''],
      ['-5n', '-5', '-5'],
      ['0x17n', '23', '23'],
    ]) {
      const scan = scanJasmine(`describe(${source}, () => it(${source}, () => {}));`);
      expect(onlyTest(scan).title, source).toBe(specName);
      expect(scan.suites[0].path, source).toEqual([suiteName]);
      expect(codes(scan), source).not.toContain('dynamic-title');
    }
    const returned = scanJasmine('const market = false; describe(...[(() => market)(), () => it(...[0, () => {}])]);');
    expect(onlyTest(returned).title).toBe('');
    expect(returned.suites[0].path).toEqual(['false']);
    const promised = scanJasmine('it((async () => false)(), () => {});');
    expect(onlyTest(promised).title).toBe('(async () => false)()');
    expect(codes(promised)).toContain('dynamic-title');
  });

  it('uses evaluated operands when a Jasmine helper builds a title', () => {
    for (const [title, expected] of [
      ["desk() + ' opens'", 'cash desk opens'],
      ['true ? desk() : closed()', 'cash desk'],
      ['missing() ?? desk()', 'cash desk'],
      ['desk() || closed()', 'cash desk'],
      ["desk() && 'opens'", 'opens'],
      ["desk() === 'cash desk'", 'true'],
      ['-fee()', '-7'],
      ['+fee()', '7'],
      ['!missing()', 'true'],
      ['`market ${desk()}`', 'market cash desk'],
    ]) {
      const scan = scanJasmine(`
function desk(){return 'cash desk';} function missing(){return null;}
function fee(){return 7;} function closed(){throw Error('closed');}
try { describe(${title}, () => it((() => (${title}))(), () => {})); }
catch { it('recovers the market', () => {}); }`);
      expect(
        scan.tests.map((test) => test.fullName),
        title,
      ).toEqual([expected + ' > ' + expected]);
    }
  });

  it('formats a Jasmine array description and continues after registering the suite', () => {
    for (const [array, title] of [
      ["['cash', 'desk']", 'cash,desk'],
      ['[]', ''],
      ["[['cash', null], ['desk', 7], undefined]", 'cash,,desk,7,'],
      ["['cash', ...['desk', 7]]", 'cash,desk,7'],
    ]) {
      const scan = scanJasmine(`const parts = ${array};
try { describe(parts, () => it((() => parts)(), () => {})); }
catch { it('recovers the market', () => {}); }`);
      expect(scan.suites[0].path, array).toEqual([title]);
      expect(onlyTest(scan).title, array).toBe(title);
      expect(codes(scan)).not.toContain('dynamic-title');
    }
    const invalid = scanJasmine(`try {
  describe([{toString: null, valueOf: null}], () => it('opens the desk', () => {}));
} catch { it('recovers the market', () => {}); }`);
    expect(codes(invalid)).toContain('dynamic-title');
    expect(invalid.tests.map((test) => test.title)).toContain('recovers the market');
  });

  it('chooses a Jasmine title from the result of registering a spec, suite or hook', () => {
    for (const [title, expected] of [
      ["it('records a fee') ? 'cash desk' : closed()", 'cash desk'],
      ["describe('fee desk', () => it('records a fee', () => {})) && 'risk office'", 'risk office'],
      ["beforeEach(() => {}) ?? 'cash desk'", 'cash desk'],
      ["(() => !it('records a fee', () => {}))()", ''],
    ]) {
      const scan = scanJasmine(`function closed(){ throw Error('market closed'); }
try { it(${title}, () => {}); } catch { it('recovers the market', () => {}); }`);
      const names = scan.tests.map((test) => test.fullName);
      expect(names, title).toContain(expected);
      expect(names, title).not.toContain('recovers the market');
    }
  });

  it('tests an object used in a Jasmine title without coercing it', () => {
    for (const guard of [
      "({toString(){ throw Error('closed'); }})",
      '[() => {}]',
      '(() => {})',
      '(class Desk {})',
      '/quotes/',
      '(function*(){})()',
      '(async () => false)()',
    ]) {
      const scan = scanJasmine(`it((${guard} || 'risk office') ? 'cash desk' : 'risk office', () => {});`);
      expect(onlyTest(scan).title, guard).toBe('cash desk');
    }
  });

  it('uses the title returned by a Jasmine helper on the path that completed', () => {
    for (const [title, expected] of [
      ['((name = desk) => name)()', 'cash desk'],
      ["(({ market }) => market)({ market: 'bond desk' })", 'bond desk'],
      ["(() => { try { return 'auction'; } finally { return 'closing auction'; } })()", 'closing auction'],
      ['selectDesk(false)', 'risk office'],
      ["(() => { const desk = 'repo desk'; return desk; })()", 'repo desk'],
      ['(() => { const label = desk; return label; })()', 'cash desk'],
      ['(() => selectDesk(true))()', 'cash desk'],
    ]) {
      const scan = scanJasmine(`const desk = 'cash desk';
function selectDesk(cash) { if (cash) return desk; return 'risk office'; }
try { describe(${title}, () => it(${title}, () => {})); }
catch { it('recovers the market', () => {}); }`);
      expect(
        scan.tests.map((test) => test.fullName),
        title,
      ).toEqual([expected + ' > ' + expected]);
    }
  });

  it('omits recovery after an immediately invoked Jasmine title function completes', () => {
    const scan = scanJasmine(`const deskName = 'cash desk';
try { it(((title = deskName) => title)(), () => {}); }
catch { it('recovers the desk', () => {}); }`);
    expect(scan.tests.some((test) => test.title === 'recovers the desk')).toBe(false);
  });

  it('stops at a refused Jasmine hook and counts only hooks that completed registration', () => {
    for (const hook of ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'] as const) {
      for (const args of [
        '',
        '42',
        'null',
        '{}',
        'function* quotes() {}',
        'async function* quotes() {}',
        '() => {}, 2147483648',
        "it('records a quote', () => {})",
      ]) {
        const scan = scanJasmine(
          `try { ${hook}(${args}); it('continues registration', () => {}); }
          catch { it('recovers the feed', () => {}); }`,
          { frameworkVersion: '7.0.2' },
        );
        expect(testNamed(scan, 'continues registration').state, hook + args).toBe('notLoaded');
        const recovery = testNamed(scan, 'recovers the feed');
        expect([recovery.state, recovery.hooks[hook]]).toEqual(['active', 0]);
        expect(codes(scan)).toContain('invalid-hook');
        if (args.startsWith('it(')) expect(testNamed(scan, 'records a quote').state).toBe('active');
      }
    }
  });

  it('accepts Jasmine hook callbacks with ignored extra arguments and checks timeouts from Jasmine 3.10', () => {
    for (const [version, args, rejected] of [
      ['3.9.0', '() => {}, 2147483648', false],
      ['3.10.0', '() => {}, 2147483648', true],
      ['7.0.2', 'async () => {}, "slow", 5', false],
      ['7.0.2', 'class Quotes {}', false],
      ['7.0.2', '() => {}, 0, it("registers a quote", () => {})', false],
    ] as const) {
      const scan = scanJasmine(
        `try { beforeEach(${args}); it('continues registration', () => {}); }
        catch { it('recovers the feed', () => {}); }`,
        { frameworkVersion: version },
      );
      const next = testNamed(scan, 'continues registration');
      expect(next.state, version + args).toBe(rejected ? 'notLoaded' : 'active');
      expect(next.hooks.beforeEach).toBe(rejected ? 0 : 1);
      expect(scan.tests.some((test) => test.title === 'recovers the feed')).toBe(rejected);
    }
  });

  it('preserves the caller catch when a Jasmine hook timeout can throw during iteration or coercion', () => {
    for (const limit of ['...readTimeouts()', '{ valueOf() { throw Error("quote unavailable"); } }']) {
      const result = scanJasmine(`try { beforeEach(() => {}, ${limit}); }
        catch { it('recovers the feed', () => {}); }`);
      expect(testNamed(result, 'recovers the feed').state, limit).toBe('active');
      expect(codes(result)).not.toContain('invalid-hook');
    }
    const result = scanJasmine(`try { beforeEach(() => {}, null); }
      catch { it('recovers the feed', () => {}); } it('opens the desk', () => {});`);
    expect(onlyTest(result).title).toBe('opens the desk');
    expect(onlyTest(result).hooks.beforeEach).toBe(1);
  });

  it('reads the first two Jasmine hook arguments across array holes, nested spreads and strings', () => {
    for (const [args, refused] of [
      ['...[]', true],
      ['...[], ready', false],
      ['...[ready]', false],
      ['...[...[ready], ...[25]]', false],
      ['ready, ...[...[], 2147483648]', true],
      ['...[, ready]', true],
      ['...[ready,, 2147483648]', false],
      ["...'desk'", true],
      ["ready, ...'45'", false],
      ["...'', ready", false],
      ['...[prices, 25]', true],
      ['...empty, ...empty, ready', false],
      ['...hooks', false],
      ['...waits', true],
      ['...words', true],
      ['...[[ready][0], ...[2147483648]]', true],
    ] as const) {
      const scan = scanJasmine(`
const ready = () => {};
function* prices() {}
const hooks = [ready, 25], empty = [], waits = [55], words = 'open';
try { beforeEach(${args}); it('continues registration', () => {}); }
catch { it('recovers the hook', () => {}); }`);
      expect(testNamed(scan, 'continues registration').state, args).toBe(refused ? 'notLoaded' : 'active');
      expect(
        scan.tests.some((test) => test.title === 'recovers the hook'),
        args,
      ).toBe(refused);
    }
  });

  it('preserves the callback binding of a spread hook argument and accounts for later argument evaluation', () => {
    const scan = scanJasmine(`
function closeBook() { pending('closing auction'); }
const setup = [closeBook, 25];
{ const closeBook = function* prices() {}; beforeEach(...setup); }
it('quotes the opening price', () => {});`);
    expect(onlyTest(scan).state).toBe('skip');
    for (const body of [
      'const callbacks = [function* prices() {}]; callbacks[0] = () => {}; beforeEach(...callbacks);',
      'const callbacks = [function* prices() {}]; const alias = callbacks; alias[0] = () => {}; beforeEach(...callbacks);',
    ]) {
      const changed = scanJasmine(body + "it('quotes the opening price', () => {});");
      expect(onlyTest(changed).state).toBe('active');
    }
    const dynamic = scanJasmine(`
function readOptions() { return [() => {}, 25]; }
const options = [...readOptions(), 2147483648];
beforeEach(...options);
it('quotes the opening price', () => {});`);
    expect(onlyTest(dynamic).state).toBe('active');
    expect(codes(dynamic)).not.toContain('invalid-hook');
    const thrown = scanJasmine(`function closed() { throw Error('closed'); }
try { beforeEach(...[() => {}, 5, it('prices a quote', () => {}), closed()]); it('continues registration', () => {}); }
catch { it('recovers the hook', () => {}); }`);
    expect(testNamed(thrown, 'continues registration').state).toBe('notLoaded');
    expect(testNamed(thrown, 'prices a quote').state).toBe('active');
    expect(testNamed(thrown, 'recovers the hook').hooks.beforeEach).toBe(0);
  });

  it('stops when Jasmine rejects a spec callback or timeout after evaluating its arguments', () => {
    for (const api of ['it', 'xit', 'fit']) {
      for (const args of [
        "'quotes the fill', prices",
        "'quotes the fill', async function* quotes() {}",
        "'quotes the fill', count",
        "'quotes the fill', ready, [2147483648]",
        "...['quotes the fill', ready, 2147483648]",
        "'quotes the fill', it('records a bid', ready)",
        "'quotes the fill', ready, '2147483648', it('records a bid', ready)",
      ]) {
        const scan = scanJasmine(`const count = 42; const ready = () => {}; function* prices() {}
try { ${api}(${args}); it('continues registration', ready); }
catch { it('recovers the fill', ready); }`);
        expect(testNamed(scan, 'continues registration').state, api + args).toBe('notLoaded');
        expect(testNamed(scan, 'recovers the fill').state).toBe('active');
        if (args.includes('records a bid')) expect(testNamed(scan, 'records a bid').state).toBe('active');
      }
    }
  });

  it('resolves omitted, undefined and shadowed callbacks before applying the Jasmine spec timeout', () => {
    for (const [api, args, version, pending] of [
      ['it', "'quotes the fill', absent, 2147483648", '3.9.0', true],
      ['it', "'quotes the fill', absent, 2147483648", '3.10.0', null],
      ['xit', "...['quotes the fill',, 2147483648]", '7.0.2', null],
      ['fit', "'quotes the fill', absent", '7.0.2', null],
      ['it', "'quotes the fill', absent", '7.0.2', true],
      ['it', "'quotes the fill', undefined", '7.0.2', false],
      ['fit', "'quotes the fill', undefined", '7.0.2', false],
      ['it', '...fields', '7.0.2', false],
    ] as const) {
      const scan = scanJasmine(
        `
const absent = void 0;
{ const undefined = () => {}; const fields = ['quotes the fill', undefined, 25];
try { ${api}(${args}); it('continues registration', undefined); }
catch { it('recovers the fill', undefined); } }`,
        { frameworkVersion: version },
      );
      expect(testNamed(scan, 'continues registration').state, api + args + version).toBe(
        pending === null ? 'notLoaded' : 'active',
      );
      expect(
        scan.tests.some((t) => t.title === 'recovers the fill'),
        args,
      ).toBe(pending === null);
      if (pending !== null) expect(testNamed(scan, 'quotes the fill').state).toBe(pending ? 'skip' : 'active');
      if (args === '...fields') expect(testNamed(scan, 'quotes the fill').timeout).toBe(25);
    }
  });

  it('evaluates a void spec callback operand and leaves a catch reachable for custom timeout coercion', () => {
    const scan = scanJasmine(`try { it('quotes the fill', void it('records a bid', () => {})); }
catch { it('recovers the fill', () => {}); }`);
    expect(testNamed(scan, 'records a bid').state).toBe('active');
    expect(testNamed(scan, 'quotes the fill').state).toBe('skip');
    expect(scan.tests.some((test) => test.title === 'recovers the fill')).toBe(false);
    const ambiguous = scanJasmine(`try { it('quotes the fill', () => {}, [{ toString: 0, valueOf: 0 }]); }
catch { it('recovers the fill', () => {}); }`);
    expect(testNamed(ambiguous, 'recovers the fill').state).toBe('active');
    expect(ambiguous.diagnostics.some((d) => d.level === 'error')).toBe(false);
  });

  it('collects suite callbacks spread from a tuple in their defining scope', () => {
    for (const api of ['describe', 'xdescribe', 'fdescribe']) {
      for (const args of ['...setup', '...inlineSetup', "...[...['cash desk'], ...[book]]"]) {
        const scan = scanJasmine(`
const desk = 'records a quote';
function book() { it(desk, () => {}); }
const setup = ['cash desk', book], inlineSetup = ['cash desk', () => it(desk, () => {})];
try { { const desk = 'records a fee'; ${api}(${args}, it('opens the market', () => {})); } }
catch { it('recovers the market', () => {}); }`);
        expect(
          scan.tests.map((test) => test.fullName),
          api + args,
        ).toContain('cash desk > records a quote');
        expect(testNamed(scan, 'opens the market').fullName).toBe('opens the market');
        expect(
          scan.tests.some((test) => test.title === 'recovers the market'),
          api + args,
        ).toBe(false);
      }
    }
  });

  it('rejects invalid spread suite callbacks after evaluating ignored arguments', () => {
    for (const api of ['describe', 'xdescribe', 'fdescribe']) {
      for (const args of [
        "...['cash desk',, book]",
        "...['cash desk', null]",
        "...['cash desk', ledger]",
        "...['cash desk', async () => {}]",
      ]) {
        const scan = scanJasmine(`function* ledger() {} function book() {}
try { ${api}(${args}, it('opens the market', () => {})); it('continues registration', () => {}); }
catch { it('recovers the market', () => {}); }`);
        expect(testNamed(scan, 'continues registration').state, api + args).toBe('notLoaded');
        expect(testNamed(scan, 'recovers the market').state).toBe('active');
        expect(testNamed(scan, 'opens the market').state).toBe('active');
      }
    }
  });

  it('resumes outside a caught suite error and keeps recovery for a callback or title that may throw', () => {
    for (const args of ['...[]', "'cash desk', null"]) {
      const scan = scanJasmine(`
try { try { describe(${args}); } catch { it('recovers the suite', () => {}); } }
catch { it('recovers the caller', () => {}); }`);
      expect(testNamed(scan, 'recovers the suite').state).toBe('active');
      expect(scan.tests.some((test) => test.title === 'recovers the caller')).toBe(false);
    }
    for (const args of ["'cash desk', invalidBody()", 'title, book']) {
      const scan = scanJasmine(`
function invalidBody(){ return null; } function book(){ it('opens the market', () => {}); }
const title = { toString() { throw Error('closed'); } };
try { describe(${args}); } catch { it('recovers the caller', () => {}); }`);
      expect(testNamed(scan, 'recovers the caller').state, args).toBe('active');
    }
    const hole = scanJasmine(`function book() { it('opens the market', () => {}); }
try { describe(...[,book]); } catch { it('recovers the caller', () => {}); }`);
    expect(hole.tests.some((test) => test.title === 'recovers the caller')).toBe(false);
  });

  it('checks the actual binding when a Jasmine suite callback is named undefined', () => {
    const accepted = scanJasmine(
      `{ const undefined = () => it('quotes a bid', () => {}); describe('cash desk', undefined); }`,
    );
    expect(onlyTest(accepted).fullName).toBe('cash desk > quotes a bid');
    const refused = scanJasmine("describe('cash desk', undefined); it('quotes a bid', () => {});");
    expect(onlyTest(refused).state).toBe('notLoaded');
  });

  it('checks the parameters and body of each ordinary Jasmine helper call before collecting its catch', () => {
    for (const [parameters, body, args, recovery] of [
      ['bid = 5', 'return bid;', '', false],
      ['bid = 5, offer = bid', 'return offer;', 'undefined', false],
      ['bid = closed()', 'return bid;', '7', false],
      ['bid = closed()', 'return bid;', '...[]', true],
      ['{bid} = {}', 'return bid;', '...[]', false],
      ['{bid} = {}', 'return bid;', 'null', true],
      ['[bid] = [7]', 'return settle(bid);', '', false],
      ['...bids', 'return bids;', '...[4, 7]', false],
      ['bid = 5', 'throw Error("closed");', '10', true],
      ['bid = quote()', 'return bid;', '', false],
      ['bid = 5', 'if (bid) return; throw Error("closed");', '', false],
      ['bid = 5', 'if (bid) return; throw Error("closed");', '0', true],
    ] as const) {
      const result = scanJasmine(`
function closed() { throw Error('closed'); }
function quote() { it('reads the opening quote', () => {}); return 5; }
function settle(value) { return value; }
function price(${parameters}) { ${body} }
function register() { price(${args}); }
try { register(); } catch { it('recovers the order', () => {}); }`);
      expect(
        result.tests.some((test) => test.title === 'recovers the order'),
        parameters + body + args,
      ).toBe(recovery);
    }
  });

  it('counts specs from ordinary helper defaults when Jasmine checks for an empty suite', () => {
    for (const [arg, recovery] of [
      ['', false],
      ['5', true],
    ] as const) {
      const result = scanJasmine(
        `
function quote() { it('opens the desk', () => {}); return 5; }
function price(bid = quote()) { return bid; }
try { describe('closing auction', () => price(${arg})); }
catch { it('recovers the order', () => {}); }`,
        { frameworkVersion: '7.0.2' },
      );
      expect(
        result.tests.some((test) => test.title === 'recovers the order'),
        arg,
      ).toBe(recovery);
    }
  });

  it('stops at an empty Jasmine suite when a helper returns without registering a child', () => {
    for (const [version, form, refused] of [
      ['3.99.1', 'describe', false],
      ['4.0.0', 'describe', true],
      ['4.0.0', 'xdescribe', false],
      ['7.0.2', 'xdescribe', true],
      ['7.0.2', 'fdescribe', true],
    ] as const) {
      for (const [args, registers] of [
        ['5', false],
        ['', true],
      ] as const) {
        const result = scanJasmine(
          `
function quote() { it('opens the quote book', () => {}); return 5; }
function price(bid = quote()) { return bid; }
function collect() { price(${args}); }
try { ${form}('closing auction', collect); it('continues registration', () => {}); }
catch { it('recovers the suite', () => {}); }`,
          { frameworkVersion: version },
        );
        const reached = result.tests.filter((test) => test.state !== 'notLoaded').map((test) => test.title);
        expect(reached.includes('continues registration'), version + form + args).toBe(!refused || registers);
        expect(reached.includes('recovers the suite'), version + form + args).toBe(refused && !registers);
      }
    }
  });

  it('keeps a Jasmine suite with a child registered before a caught throw or an overriding finally', () => {
    for (const body of [
      "try { throw it('opens the book', () => {}); } catch {}",
      "try { describe('nested book', () => {}); } catch {}",
      'try { publish(); } finally { return; }',
      'try { throw publish(); } catch {}',
    ]) {
      const result = scanJasmine(
        `
function quote() { it('opens the book', () => {}); }
const publish = [quote].at(0);
describe('closing auction', () => { ${body} });
it('continues registration', () => {});`,
        { frameworkVersion: '7.0.2' },
      );
      expect(testNamed(result, 'continues registration').state, body).toBe('active');
    }
  });

  it('keeps the caller catch when a generator is passed to Jasmine as a suite callback', () => {
    const result = scanJasmine(`
function* orders() { it('reads the closing price', () => {}); }
try { describe('closing auction', orders); } catch { it('recovers the callback', () => {}); }`);
    expect(result.tests.some((test) => test.title === 'recovers the callback')).toBe(true);
  });

  it('marks a rejected Jasmine suite callback as not loaded and stops recovery at the handler that caught it', () => {
    for (const runner of ['describe', 'xdescribe', 'fdescribe']) {
      for (const kind of ['function*', 'async function', 'async function*']) {
        const result = scanJasmine(`
${kind} quotes(bid = it('reads the initial bid', () => {})) {
  it('reads the closing price', () => {});
}
try {
  try { ${runner}('closing auction', quotes); }
  catch { it('recovers the callback', () => {}); }
  it('closes the order', () => {});
} catch { it('recovers the outer caller', () => {}); }`);
        const loaded = result.tests.filter((test) => test.state !== 'notLoaded').map((test) => test.title);
        expect(loaded, runner + kind).toEqual(['recovers the callback', 'closes the order']);
        expect(codes(result), kind).toContain(kind === 'function*' ? 'describe-throws' : 'async-describe');
      }
    }
  });

  it('stops Jasmine registration when a default reads a parameter before it has been initialized', () => {
    for (const kind of ['function', 'function*', 'async function', 'async function*']) {
      for (const [parameters, args, fails] of [
        ['bid = 4, ask = bid', '', false],
        ['bid = ask, ask = 5', '', true],
        ['bid = bid', '', true],
        ['bid = bid', '7', false],
        ['{bid = 4, ask = bid} = {}', '', false],
        ['{bid = ask, ask = 4} = {}', '', true],
        ['[bid = ask, ask = 7] = []', '', true],
        ['bid = { ask: 5 }, ask = 4', '', false],
        ['bid = { [ask]: 5 }, ask = 4', '', true],
        ['{ [ask]: bid } = {}, ask = 4', '', true],
        ['bid = false && ask, ask = 7', '', false],
        ['bid = true && ask, ask = 7', '', true],
        ['bid = () => ask, ask = 7', '', false],
        ['bid = (() => ask)(), ask = 7', '', true],
        ['bid = [ask], ask = 7', '', true],
        ['bid = (4 as ask), ask = 7', '', false],
        ['bid = (() => { const ask = 4; return ask; })(), ask = 7', '', false],
      ] as const) {
        const result = scanJasmine(`
${kind} price(${parameters}) { it('enters the price body', () => {}); }
try { price(${args}); it('returns from price', () => {}); }
catch { it('catches the call', () => {}); }
it('closes the book', () => {});`);
        const titles = result.tests.filter((test) => test.state !== 'notLoaded').map((test) => test.title);
        expect(titles.includes('enters the price body'), kind + parameters).toBe(!kind.endsWith('*') && !fails);
        expect(titles.includes('returns from price'), kind + parameters).toBe(!fails || kind === 'async function');
        expect(titles).toContain('closes the book');
      }
    }
  });

  it('checks generator parameters at the call and leaves their registration bodies deferred', () => {
    for (const kind of ['function*', 'async function*']) {
      for (const [params, args, catches] of [
        ['', '', false],
        ['bid', '5', false],
        ['...bids', '1, 2', false],
        ['bid = 5', '', false],
        ['bid = closed()', '7', false],
        ['bid = closed()', '', true],
        ['bid = closed()', 'undefined', true],
        ['bid = quote()', '', false],
        ['{bid}', '{bid: 7}', false],
        ['{bid}', 'null', true],
        ['{bid = closed()} = {}', '', true],
        ['[bid]', '[7]', false],
        ['[bid]', '5', true],
        ['[, bid = 10] = [5]', '', false],
        ['[, bid = closed()] = [5]', '', true],
        ['bid = closed()', 'feed()', true],
        ['{bid}', 'feed()', true],
        ['[bid]', 'feed()', true],
        ['{["bid"]: bid} = {bid: 5}', '', false],
        ['{[closed()]: bid} = {}', '', true],
        ['{[{toString() { throw Error("closed"); }}]: bid} = {}', '', true],
        ['{[key]: bid} = {}', '', true],
        ['bid = 5, ask = bid', '', false],
        ['ask = bid, bid = 5', '', true],
        ['bid = bid', '', true],
      ] as const) {
        const result = scanJasmine(`
function closed() { throw Error('closed'); }
function feed() {}
const key = { toString: null, valueOf: null };
function quote() { it('reads the opening quote', () => {}); return 5; }
${kind} price(${params}) { it('iterates over prices', () => {}); throw Error('closed'); }
try { price(${args}); } catch { it('recovers the order', () => {}); }`);
        const titles = result.tests.map((test) => test.title);
        expect(titles.includes('recovers the order'), kind + params + args).toBe(catches);
        expect(titles).not.toContain('iterates over prices');
      }
    }
  });

  it('counts a child registered in a generator default when deciding whether the Jasmine suite is empty', () => {
    for (const [args, catches] of [
      ['', false],
      ['7', true],
    ] as const) {
      const result = scanJasmine(
        `
function quote() { it('reads the opening quote', () => {}); return 5; }
function* prices(bid = quote()) { it('iterates over prices', () => {}); }
try { describe('closing auction', () => prices(${args})); } catch { it('recovers the order', () => {}); }`,
        { frameworkVersion: '7.0.2' },
      );
      expect(
        result.tests.some((test) => test.title === 'recovers the order'),
        args,
      ).toBe(catches);
    }
  });

  it('keeps a generator binding failure inside its Jasmine suite callback', () => {
    for (const declaration of [
      'function* prices([bid]) {}',
      'function* prices({[closed()]:bid} = {}) {}',
      'function* prices(bid = ask, ask = 5) {}',
    ]) {
      const result = scanJasmine(
        `
function closed() { throw Error('closed'); }
${declaration}
try { describe('closing auction', () => prices()); }
catch { it('recovers the outer order', () => {}); }`,
        { frameworkVersion: '7.0.2' },
      );
      expect(
        result.tests.some((test) => test.title === 'recovers the outer order'),
        declaration,
      ).toBe(false);
    }
  });

  it('distinguishes successful spreads from noniterable or unreadable spreads in a Jasmine helper call', () => {
    for (const [arg, recovery] of [
      ["'BID'", false],
      ['[10, 12]', false],
      ['[, 10, ...[12]]', false],
      ['bids', false],
      ['10', true],
      ['null', true],
      ['{}', true],
      ['stream', true],
      ['source()', true],
      ['[...source()]', true],
      ['later', true],
    ] as const) {
      const result = scanJasmine(`
const bids = [4, 8];
const stream = { get [Symbol.iterator]() { throw Error('closed'); } };
function source() { return stream; }
async function price() {}
try { price(...${arg}); } catch { it('recovers the book', () => {}); }
const later = [3];`);
      expect(
        result.tests.some((test) => test.title === 'recovers the book'),
        arg,
      ).toBe(recovery);
    }
  });

  it('follows local helper arguments when deciding whether Jasmine catches a registration error', () => {
    const definitions = `
function bid() { return 10; }
function quote() { it('records a bid', () => {}); return 10; }
function closed() { throw Error('closed'); }
async function price(value) {}`;
    for (const [call, recovery] of [
      ['price(bid())', false],
      ['price(quote())', false],
      ['price(closed())', true],
      ['price(...closed())', true],
      ['describe("closing auction", () => price(quote()))', false],
      ['describe("closing auction", () => price(closed(), quote()))', false],
      ['describe("closing auction", () => price(quote(), closed()))', false],
      ['describe("closing auction", () => price(...closed()))', false],
      ['describe("closing auction", () => price(...10))', false],
      ['price(...unknownPrices)', true],
    ] as const) {
      const result = scanJasmine(
        `
${definitions}
try { ${call}; } catch { it('recovers the book', () => {}); }`,
        { frameworkVersion: '7.0.2' },
      );
      expect(
        result.tests.some((test) => test.title === 'recovers the book'),
        call,
      ).toBe(recovery);
    }
  });

  it('omits a synchronous catch around a local async call that returns a promise', () => {
    for (const [definition, call] of [
      ['async function price() { throw Error("closed"); }', 'price()'],
      ['const price = async () => { await 0; throw Error("closed"); };', 'price()'],
      ['async function price(value = missingQuote()) {}', 'price()'],
      ['async function price({ value }) {}', 'price(null)'],
      ['async function price() {} function settle() { price(); }', 'settle()'],
      ['async function price() { it("reads quote", () => {}); }', 'price()'],
    ]) {
      const result = scanJasmine(`
${definition}
try { ${call}; it('closes the desk', () => {}); } catch { it('recovers the call', () => {}); }`);
      const titles = result.tests.map((test) => test.title);
      expect(titles, definition).toContain('closes the desk');
      expect(titles, definition).not.toContain('recovers the call');
    }
  });

  it('keeps a catch for async call argument errors, generator defaults and possibly empty Jasmine suites', () => {
    for (const [definition, call] of [
      ['async function price(value) {}', 'price(missingQuote())'],
      ['function* price(value = missingQuote()) {}', 'price()'],
      ['async function* price(value = missingQuote()) {}', 'price()'],
      ['async function price() { await 0; it("reads quote", () => {}); }', 'describe("closing quotes", () => price())'],
      ['async function price() {}', 'describe("closing quotes", () => price())'],
    ]) {
      const result = scanJasmine(
        `
${definition}
try { ${call}; } catch { it('recovers the call', () => {}); }`,
        { frameworkVersion: '7.0.2' },
      );
      expect(
        result.tests.map((test) => test.title),
        call,
      ).toContain('recovers the call');
    }
  });

  it('stops a Jasmine registration helper when a return leaves its try or its selected catch', () => {
    for (const body of [
      'try { return 5; } catch {}',
      'try { return await 0; } catch {}',
      'try { const bid = await 0; return bid; } catch {}',
      'try { if (true) return 5; } catch {}',
      'try { await Promise.reject("closed"); } catch { return await 0; }',
      'try { try { return 5; } finally {} } finally {}',
      'try { throw Error("closed"); } finally { return; }',
    ]) {
      const result = scanJasmine(`
async function price() {
  try { ${body} } finally { it('clears the quotes', () => {}); }
  it('prices a closed book', () => {});
}
price(); it('closes the desk', () => {});`);
      expect(result.tests.map((test) => test.title).sort(), body).toEqual(['clears the quotes', 'closes the desk']);
    }
  });

  it('keeps the enclosing Jasmine helper open after a nested return or a catch that can recover', () => {
    for (const body of [
      'function book() { try { return 7; } catch {} } book();',
      'async function book() { try { return await 0; } catch {} } book();',
      '(() => { return 5; })();',
      'describe("closing auction", () => { it("checks the book", () => {}); return; });',
      'try { if (false) return 5; } catch {}',
      'try { if (feed.closed) return 5; } finally {}',
      'try { return readFeed(); } catch {}',
      'try { return await Promise.reject("closed"); } catch {}',
      'try { try { return 5; } finally { throw Error("closed"); } } catch {}',
    ]) {
      const result = scanJasmine(`async function price() { ${body} it('prices the book', () => {}); } price();`);
      expect(
        result.tests.map((test) => test.title),
        body,
      ).toContain('prices the book');
    }
  });

  it('omits unreachable recovery specs after awaiting a primitive and keeps recovery for thenables', () => {
    for (const [operand, canReject] of [
      ['0', false],
      ["'bid'", false],
      ['false', false],
      ['null', false],
      ['100n', false],
      ['({ get then() { throw Error("closed"); } })', true],
      ['({ then(resolve, reject) { reject("closed"); } })', true],
      ['quotePromise', true],
      ['/bid/', true],
    ] as const) {
      for (const prefix of ['', 'const price = ', 'return ']) {
        const result = scanJasmine(`
async function settle() {
  try { ${prefix}await (${operand}); }
  catch { it('recovers the quote', () => {}); }
  finally { it('closes the feed', () => {}); }
}
settle();`);
        const titles = result.tests.map((test) => test.title);
        expect(titles.includes('recovers the quote'), prefix + operand).toBe(canReject);
        expect(titles).toContain('closes the feed');
      }
    }
  });

  it('stops an async helper at return, a rejected await or a pending promise, preserving caller registrations', () => {
    for (const body of [
      'return;',
      'await 0; return;',
      'await Promise.reject("closed");',
      'await Promise.resolve(Promise.reject("closed"));',
      'await new Promise(() => {});',
      'await new Promise((resolve, reject) => { const quote = 25; });',
    ]) {
      const result = scanJasmine(`
async function price() { ${body} it('registers a late quote', () => {}); }
describe('cash desk', () => { price().catch(() => {}); it('closes the desk', () => {}); });`);
      expect(
        result.tests.map((test) => test.fullName),
        body,
      ).toEqual(['cash desk > closes the desk']);
    }
  });

  it('leaves recovery and cleanup suspended when the awaited promise never settles', () => {
    const result = scanJasmine(`
async function price() {
  try { await new Promise(() => {}); it('prices a trade', () => {}); }
  catch { it('recovers the feed', () => {}); }
  finally { it('clears the feed', () => {}); }
  it('settles the trade', () => {});
}
price(); it('closes the desk', () => {});`);
    expect(result.tests.map((test) => test.title)).toEqual(['closes the desk']);
  });

  it('keeps possible continuations for shadowed or modified Promise methods and unknown executors', () => {
    for (const source of [
      'const Promise = marketPromise; async function run() { await Promise.reject();',
      'Promise.reject = () => 5; async function run() { await Promise.reject();',
      'async function run() { await Promise.resolve();',
      'async function run() { await Promise.resolve(...prices);',
      'async function run() { await Promise.all([]);',
      'async function run() { await new MarketFeed();',
      'async function run() { await new Promise(executor);',
      'async function run() { await new Promise((resolve = fallback) => { resolve(5); });',
      'async function run() { await new Promise(resolve => resolve(5));',
      'async function run() { await new Promise(resolve => { const { mark } = feed; resolve(mark); });',
      'async function run() { await new Promise(resolve => { const value = settle(resolve); });',
      'async function run() { if (feed.closed) await new Promise(() => {});',
      "async function run() { for (const quote of JSON.parse('[]')) await new Promise(() => {});",
      'async function run() { try { await new Promise(() => { using book = 25; }); } catch {}',
      "async function run() { try { await Promise.reject('closed'); } catch {}",
    ]) {
      const inventory = scanJasmine(source + " it('checks the price', () => {}); } run();");
      expect(
        inventory.tests.map((test) => test.title),
        source,
      ).toContain('checks the price');
    }
  });

  it('collects resumed Jasmine helpers in microtask order after the calling suite has closed', () => {
    const result = scanJasmine(`
function start(symbol) {
  async function price() {
    it('starts ' + symbol, () => {});
    await 0;
    it('reads ' + symbol, () => {});
    await 1;
    it('settles ' + symbol, () => {});
  }
  price();
}
async function finish() { return await 0; it('reopens the desk', () => {}); }
describe('cash desk', () => {
  start('bid'); start('ask'); finish();
  it('closes the desk', () => {});
});
it('closes the market', () => {});`);
    expect(result.tests.map((test) => test.fullName)).toEqual([
      'cash desk > starts bid',
      'cash desk > starts ask',
      'cash desk > closes the desk',
      'closes the market',
      'reads bid',
      'reads ask',
      'settles bid',
      'settles ask',
    ]);
  });

  it('shares the suite opened by a resumed Jasmine helper with the next resumed helper', () => {
    const result = scanJasmine(
      `
async function price() { await 0; try { xdescribe('suspended prices', () => {}); } catch {} }
async function settle() { await 0; it('settles the trade', () => {}); }
describe('cash desk', () => {
  price(); settle(); it('closes the desk', () => {});
});`,
      { frameworkVersion: '7.0.2' },
    );
    expect(states(result)).toEqual([
      ['cash desk > closes the desk', 'active', false],
      ['suspended prices > settles the trade', 'skip', false],
    ]);
  });

  it('keeps the Jasmine suite an async helper opens before it returns, rejects or reaches its first await', () => {
    const reopen = "try { xdescribe('suspended prices', () => {}); } catch {}";
    for (const [body, skipped] of [
      [reopen, true],
      [`${reopen} throw Error('closed');`, true],
      ["xdescribe('suspended prices', () => {});", true],
      [`${reopen} await 0;`, true],
      [`await 0; ${reopen}`, false],
      [`if (false) await 0; ${reopen}`, true],
      [`if (true) await 0; ${reopen}`, false],
      [`await reopenMarket();`, true],
      [`${reopen} return; await 0;`, true],
    ] as const) {
      const result = scanJasmine(
        `
function reopenMarket() { ${reopen} return 0; }
async function checkMarket() { ${body} }
describe('cash desk', () => {
  it('records the trade', () => {}, 25, checkMarket().catch(() => {}));
  it('closes the book', () => {});
});`,
        { frameworkVersion: '7.0.2' },
      );
      for (const title of ['records the trade', 'closes the book']) {
        const test = testNamed(result, title);
        expect([test.fullName, test.state], body).toEqual([
          skipped ? 'cash desk > suspended prices > ' + title : 'cash desk > ' + title,
          skipped ? 'skip' : 'active',
        ]);
      }
    }
  });

  it('registers a spec, suite or hook under the current Jasmine suite after evaluating its arguments', () => {
    for (const frameworkVersion of ['4.0.0', '5.13.0', '7.0.2']) {
      const result = scanJasmine(
        `
function reopen() { try { xdescribe('suspended feed', () => {}); } catch {} return 25; }
describe('cash desk', () => {
  it('accepts the trade', () => {}, reopen());
  beforeEach(() => {}, reopen());
  describe('closing auction', () => { it('prices a fill', () => {}); }, reopen());
});`,
        { frameworkVersion },
      );
      const parents = (times: number) => [
        'cash desk',
        ...Array<string>(frameworkVersion === '4.0.0' ? 0 : times).fill('suspended feed'),
      ];
      const trade = testNamed(result, 'accepts the trade'),
        fill = testNamed(result, 'prices a fill');
      expect(trade.fullName).toBe([...parents(1), 'accepts the trade'].join(' > '));
      expect(fill.fullName).toBe([...parents(3), 'closing auction', 'prices a fill'].join(' > '));
      expect(trade.hooks.beforeEach).toBe(frameworkVersion === '4.0.0' ? 1 : 0);
      expect(fill.hooks.beforeEach).toBe(1);
      expect(fill.state).toBe(frameworkVersion === '4.0.0' ? 'active' : 'skip');
    }
  });

  it('binds standalone helper calls in the enclosing suite and stops later registrations when a binding throws', () => {
    const result = scanJasmine(`
function request({price}, side = it('loads the side', () => {})) { it('requests a trade', () => {}); }
function* quotes(side = it('looks up the symbol', () => {})) { it('yields a quote', () => {}); }
describe('cash desk', () => {
  quotes('buy'); quotes();
  try { request(null); it('finishes the request', () => {}); } catch { it('recovers the book', () => {}); }
  request(...[{price: 10}, 'sell']);
  it('closes the desk', () => {});
});`);
    expect(result.tests.filter((test) => test.state !== 'notLoaded').map((test) => test.fullName)).toEqual([
      'cash desk > looks up the symbol',
      'cash desk > recovers the book',
      'cash desk > requests a trade',
      'cash desk > closes the desk',
    ]);
  });

  it('evaluates standalone call arguments in order and enters only the synchronous body of an invoked function', () => {
    const result = scanJasmine(`
function read() { it('opens the feed', () => {}); return 1; }
function collect(q) { it('collects the book', () => {}); }
describe('cash desk', () => {
  collect(read(), () => it('runs a deferred callback', () => {}));
  (function*(price = it('loads the price', () => {})) { it('yields a price', () => {}); })();
  (async function({bid}) { it('enters the async body', () => {}); })(null).catch(() => {});
  try { collect(read(), ...false, it('reads a late quote', () => {})); }
  catch { it('clears the quote', () => {}); }
  it('closes the desk', () => {});
});`);
    expect(result.tests.filter((test) => test.state !== 'notLoaded').map((test) => test.fullName)).toEqual([
      'cash desk > opens the feed',
      'cash desk > collects the book',
      'cash desk > loads the price',
      'cash desk > opens the feed',
      'cash desk > clears the quote',
      'cash desk > closes the desk',
    ]);
  });

  it('binds array patterns from string code points and object patterns from boxed properties', () => {
    const result = scanJasmine(`
function readChars([first = it('loads first character', () => {}), ...[second = it('loads second character', () => {})]]) {
  it('reads ' + first, () => {});
}
function readBook({0: first = it('loads first entry', () => {}), length: count = it('loads length', () => {}),
                   3: end = it('loads final entry', () => {})}) { it('counts ' + count, () => {}); }
function readTick({toString: display = it('loads renderer', () => {}), quote = it('loads the quote', () => {})}) {}
it('records the trade', () => {}, 25, readChars('\\u{1D54F}'), readBook([4]), readBook('FX'), readTick(42));`);
    expect(result.tests.map((test) => test.title)).toEqual([
      'loads second character',
      'reads 𝕏',
      'loads final entry',
      'counts 1',
      'loads final entry',
      'counts 2',
      'loads the quote',
      'records the trade',
    ]);
  });

  it('stops on a refused parameter binding after earlier defaults and before later defaults or the helper body', () => {
    for (const [binding, argument] of [
      ['{bid}', 'null'],
      ['{bid}', 'undefined'],
      ['{book: {bid}}', '{book: null}'],
      ['[bid]', '15'],
    ]) {
      const result = scanJasmine(`
function consume(start = it('opens the feed', () => {}), ${binding}, end = it('reads the last quote', () => {})) {
  it('enters the pricing helper', () => {});
}
describe('cash desk', () => {
  try { it('accepts the trade', () => {}, 25, consume(undefined, ${argument})); }
  catch { it('recovers the feed', () => {}); }
  it('closes the desk', () => {});
});`);
      expect(
        result.tests.map((test) => test.fullName),
        binding,
      ).toEqual(['cash desk > opens the feed', 'cash desk > recovers the feed', 'cash desk > closes the desk']);
    }
  });

  it('stops spreading a non-iterable before later arguments and still evaluates object spreads and strings', () => {
    for (const expression of [
      "record(it('opens the feed', () => {}), ...null, it('reads the late quote', () => {}))",
      "[it('opens the feed', () => {}), ...false, it('reads the late quote', () => {})]",
      "new Ticket(it('opens the feed', () => {}), ...{}, it('reads the late quote', () => {}))",
    ]) {
      const result = scanJasmine(`
function record() {}
class Ticket {}
try { it('accepts the trade', () => {}, 25, ${expression}); }
catch { it('recovers the feed', () => {}); }
it('closes the desk', () => {}, 25, {...null, ...false, quote: it('opens the book', () => {})}, [...'FX']);`);
      expect(
        result.tests.map((test) => test.title),
        expression,
      ).toEqual(['opens the feed', 'recovers the feed', 'opens the book', 'closes the desk']);
    }
  });

  it('keeps an async parameter rejection inside its promise but propagates invalid spreads before the async call', () => {
    const result = scanJasmine(`
async function record({bid}) { it('enters the pricing helper', () => {}); }
async function* quotes({bid}) {}
it('accepts a rejected promise', () => {}, 25, record(null).catch(() => {}));
try { it('accepts an invalid spread', () => {}, 25, record(...false).catch(() => {})); }
catch { it('recovers the spread', () => {}); }
try { it('requests quotes', () => {}, 25, quotes()); }
catch { it('recovers the iterator', () => {}); }`);
    expect(result.tests.map((test) => test.title)).toEqual([
      'accepts a rejected promise',
      'recovers the spread',
      'recovers the iterator',
    ]);
  });

  it('evaluates registration arguments in order before entering the Jasmine declaration', () => {
    const result = scanJasmine(`
function readTitle() { it('reads the quote', () => {}); return 'closing auction'; }
function rejectCallback() { it('checks the feed', () => {}); throw Error('no feed'); }
describe('cash desk', () => {
  try { describe(readTitle(), rejectCallback(), it('evaluates the late argument', () => {})); }
  catch { it('recovers the market', () => {}); }
  it('closes the desk', () => {});
});`);
    expect(result.tests.map((test) => test.fullName)).toEqual([
      'cash desk > reads the quote',
      'cash desk > checks the feed',
      'cash desk > recovers the market',
      'cash desk > closes the desk',
    ]);
    expect(result.suites.map((suite) => suite.path)).toEqual([['cash desk']]);
  });

  it('evaluates eager fields and conditions in extra arguments while leaving function values dormant', () => {
    const result = scanJasmine(`
function begin() { it('opens the book', () => {}); return 25; }
describe('cash desk', () => {
  it('checks settlement', () => {}, 50, [
    { start: true && begin(), later: () => it('defers validation', () => {}) },
    false ? it('ignores the quote', () => {}) : 0,
    () => it('defers the hedge', () => {}),
  ]);
});`);
    expect(result.tests.map((test) => test.fullName)).toEqual([
      'cash desk > opens the book',
      'cash desk > checks settlement',
    ]);
  });

  it('runs generator defaults and synchronous async registrations without entering a generator body or throwing a rejection', () => {
    const result = scanJasmine(`
describe('cash desk', () => {
  function* quotes(market = it('binds the market', () => {})) { it('yields the quote', () => {}); }
  async function rejectQuote() { it('reads the quote', () => {}); throw Error('closed'); }
  it('records the trade', () => {}, 4, quotes(), rejectQuote().catch(() => {}));
  it('closes the desk', () => {});
});`);
    expect(states(result)).toEqual([
      ['cash desk > binds the market', 'active', false],
      ['cash desk > reads the quote', 'active', false],
      ['cash desk > records the trade', 'active', false],
      ['cash desk > closes the desk', 'active', false],
    ]);
  });

  it('evaluates class keys before static fields and blocks in a declaration argument', () => {
    const result = scanJasmine(`
function key() { it('names the quote', () => {}); return 'quote'; }
it('records the trade', () => {}, 4, class {
  static bid = it('loads the market', () => {});
  [key()] = it('prices an instance', () => {});
  static { it('opens the ledger', () => {}); }
  get price() { it('reads an instance', () => {}); }
});`);
    expect(result.tests.map((test) => test.title)).toEqual([
      'names the quote',
      'loads the market',
      'opens the ledger',
      'records the trade',
    ]);
  });

  it('runs helper parameter defaults only for undefined values, including spread and destructured arguments', () => {
    const result = scanJasmine(`
function quote(price = it('loads a price', () => {})) {}
function fees({rates: [rate = it('loads a rate', () => {})]} = {rates: []}) {}
function limit() { const {daily = it('loads the desk limit', () => {})} = {}; }
describe('cash desk', () => {
  it('uses supplied prices', () => {}, 25, quote(null), quote(...[30]), fees(...[{rates: [15]}]));
  it('uses default prices', () => {}, 25, quote(undefined), fees(), limit());
});`);
    expect(result.tests.map((test) => test.title)).toEqual([
      'uses supplied prices',
      'loads a price',
      'loads a rate',
      'loads the desk limit',
      'uses default prices',
    ]);
  });

  it('keeps a possible default registration after an unresolved spread without stopping the enclosing call', () => {
    const result = scanJasmine(`
function fallback() { it('opens the reserve feed', () => {}); throw Error('reserve unavailable'); }
function quote(price = fallback()) {}
function fees({price = it('loads the fee', () => {})}) {}
it('reads the feed', () => {}, 25, quote(...currentPrices));
it('reads a symbol', () => {}, 25, quote(...'FX'));
it('reads the fee', () => {}, 25, fees(currentBook));
it('closes the ledger', () => {});`);
    for (const title of ['opens the reserve feed', 'loads the fee']) {
      expect(testNamed(result, title).isInCondition).toBe(true);
    }
    expect(result.tests.filter((test) => test.title === 'opens the reserve feed')).toHaveLength(1);
    for (const title of ['reads the feed', 'reads a symbol', 'reads the fee', 'closes the ledger']) {
      expect(testNamed(result, title).state).toBe('active');
    }
  });

  it('omits a recovery spec when the preceding Jasmine registrations complete normally', () => {
    for (const frameworkVersion of ['3.99.1', '4.0.0', '5.13.0', '7.0.2']) {
      for (const [api, refused] of [
        ['describe', frameworkVersion !== '3.99.1'],
        ['xdescribe', !['3.99.1', '4.0.0'].includes(frameworkVersion)],
      ] as const) {
        const result = scanJasmine(
          `
function collectMarket() { ${api}('closing auction', () => { beforeEach(() => {}); }); }
try { collectMarket(); } catch (error) { it('recovers auction prices', () => {}); }
try { describe('settlement', () => { it('settles a fill', () => {}); }); }
catch (error) { it('recovers settlement', () => {}); }
finally { it('closes the ledger', () => {}); }`,
          { frameworkVersion },
        );
        expect(result.tests.some((test) => test.title === 'recovers auction prices')).toBe(refused);
        expect(result.tests.some((test) => test.title === 'recovers settlement')).toBe(false);
        expect(testNamed(result, 'closes the ledger').state).toBe(api === 'xdescribe' && refused ? 'skip' : 'active');
      }
    }
  });

  it('keeps recovery specs when evaluating a runner argument, helper, or binding can throw', () => {
    for (const body of [
      "it('settles a fill', () => {}, timeout());",
      "describe(feed.title, () => { it('prices a trade', () => {}); });",
      "it('settles a fill', getCallback());",
      "const { quote } = feed; it('prices a trade', () => {});",
      'loadMarket(); function loadMarket() { readExternalFeed(); }',
      'loadMarket(); const loadMarket = () => {};',
      "describe('closing auction', () => {});",
    ]) {
      const result = scanJasmine(`try { ${body} } catch (error) { it('recovers the book', () => {}); }`);
      expect(
        result.tests.some((test) => test.title === 'recovers the book'),
        body,
      ).toBe(true);
    }
  });

  it('follows local calls, literal conditions and nested recovery before omitting a catch', () => {
    for (const body of [
      "; const market = 'open'; let quote; if (market) it('prices a fill');",
      "if (false) { quote(); } else { it('settles a fill', () => {}, 1000); }",
      "if (false) { throw Error('closed'); }",
      'function check() {} beforeEach(check, 1000); afterEach(() => {});',
      "beforeEach(() => {}, 'slow');",
      'beforeEach(() => {}, 10, 20);',
      "it('quotes', () => {}, 1, 2);",
      "function register() { return it('prices a fill', () => {}); } register([1]);",
      "const register = () => it('prices a fill', () => {}); register();",
      'function register() { return; } register();',
      'async function update() {} update();',
      'function* update() {} update();',
      "const title = 'quotes'; function register(){ it(title, () => {}); } register();",
      "function quotes(){ it('prices a fill', () => {}); } describe('quotes', quotes);",
      "try { throw Error('closed'); } catch { it('checks the feed'); }",
      "try { throw Error('closed'); } catch (error) {} finally { it('closes the book'); }",
      "try { describe('auction', () => {}); } catch { it('recovers the auction', () => {}); }",
      "try { describe('quotes', (done) => {}); } catch { it('recovers the feed', () => {}); }",
      "function load() { try { throw Error('closed'); } finally { return 2; } } load();",
      "describe('closing desk', () => { throw Error('closed'); });",
    ]) {
      const scan = scanJasmine(`try { ${body} } catch (error) { it('restores market data', () => {}); }`);
      expect(
        scan.tests.some((t) => t.title === 'restores market data'),
        body,
      ).toBe(false);
    }
  });

  it('retains a catch when scope, invocation or control flow makes completion uncertain', () => {
    for (const body of [
      'const update = 2; update();',
      'function update(side) {} update(...sides);',
      'function update(side) {} update(readSide());',
      'function update(side = readSide()) {} update();',
      'function update() { return readQuote(); } update();',
      'function update() {} update = invalidQuote; update();',
      "function publish(run) { it('prices a fill', run); } publish(42);",
      'book.publish();',
      "report('closing auction');",
      'const tick = quote();',
      'using feed = null;',
      'while (marketOpen) quote();',
      'if (isOpen) quote();',
      'const update = () => update(); update();',
      ';'.repeat(300),
      'beforeEach(...hooks);',
      'beforeEach(42);',
      'beforeEach(function* quotes() {});',
      "it('quotes', function* ticks() {});",
      "it('quotes', () => {}, 2147483648);",
      "describe('quotes', () => { externalFeed(); });",
      "describe('quotes', getCallback());",
      "try { throw Error('closed'); } catch ({ message }) { it('reports the outage'); }",
    ]) {
      const scan = scanJasmine(`try { ${body} } catch (error) { it('restores market data', () => {}); }`);
      expect(
        scan.tests.some((t) => t.title === 'restores market data'),
        body,
      ).toBe(true);
    }
  });

  it('checks when a captured title is initialized relative to the call that reads it', () => {
    const before = scanJasmine(`
const market = 'spot orders';
function register() { it(market, () => {}); }
try { register(); } catch { it('recovers the feed', () => {}); }
`);
    expect(before.tests.some((test) => test.title === 'recovers the feed')).toBe(false);
    const after = scanJasmine(`
function register() { it(market, () => {}); }
try { register(); } catch { it('recovers the feed', () => {}); }
const market = 'spot orders';
`);
    expect(testNamed(after, 'recovers the feed').state).toBe('active');
  });

  it('registers recovered specs under the empty suite Jasmine still has open', () => {
    for (const frameworkVersion of ['4.0.0', '4.4.0', '4.5.0', '5.13.0', '6.3.0', '7.0.2']) {
      const inventory = scanJasmine(
        `
describe('cash desk', () => {
  const feed = 'closing feed';
  try { describe(feed, () => { beforeEach(() => {}); }); }
  catch (error) { it('restores quotes', () => {}); }
  describe('hedges', () => { it('rolls futures', () => {}); });
});
it('closes the market', () => {});
`,
        { frameworkVersion },
      );
      const kept = !['4.0.0', '4.4.0'].includes(frameworkVersion);
      const parent = kept ? ['cash desk', 'closing feed'] : ['cash desk'];
      expect(testNamed(inventory, 'restores quotes'), frameworkVersion).toMatchObject({
        suitePath: parent,
        hooks: { beforeEach: kept ? 1 : 0 },
        state: 'active',
      });
      expect(testNamed(inventory, 'rolls futures').suitePath).toEqual([...parent, 'hedges']);
      expect(testNamed(inventory, 'closes the market').suitePath).toEqual([]);
      expect(inventory.suites.map((suite) => suite.path)).toContainEqual(['cash desk', 'closing feed']);
    }
  });

  it('preserves recovered skipped and focused suites through helpers and finalizers', () => {
    for (const api of ['xdescribe', 'fdescribe']) {
      const result = scanJasmine(
        `
function loadFeed() { ${api}('closing feed', () => {}); }
try { loadFeed(); } catch (error) {
  try { describe('hedge feed', () => {}); } finally { it('restores the hedge', () => {}); }
}
`,
        { frameworkVersion: '7.0.2' },
      );
      expect(testNamed(result, 'restores the hedge')).toMatchObject({
        suitePath: ['closing feed', 'hedge feed'],
        state: 'notLoaded',
      });
      const recovered = scanJasmine(
        `try { ${api}('closing feed', () => {}); } catch (error) {} it('restores quotes', () => {});`,
      );
      expect(testNamed(recovered, 'restores quotes')).toMatchObject({
        suitePath: ['closing feed'],
        state: api === 'xdescribe' ? 'skip' : 'active',
        isOnly: api === 'fdescribe',
      });
    }
  });

  it('keeps a Jasmine file loaded when it catches its own registration error', () => {
    for (const expandCases of [false, true]) {
      const result = scanJasmine(
        `
function rejectFee() { it('charges a fee', 42); }
it('opens the market', () => {});
try {
  rejectFee();
  it('enters a late fill', () => {});
} catch (error) {
  it('recovers the fee', () => {});
} finally {
  it('clears the ledger', () => {});
}
it('closes the market', () => {});
`,
        { expandCases },
      );
      expect(testNamed(result, 'opens the market').state).toBe('active');
      expect(testNamed(result, 'enters a late fill')).toMatchObject({
        state: 'notLoaded',
        stateSource: 'file',
        stateLine: 2,
      });
      expect(testNamed(result, 'recovers the fee').state).toBe('active');
      expect(testNamed(result, 'clears the ledger').state).toBe('active');
      expect(testNamed(result, 'closes the market').state).toBe('active');
      expect(result.diagnostics.find((d) => d.code === 'test-without-body')?.message).not.toContain('stops before');
    }
  });

  it('rejects every spec if an exception escapes the file after recovery or cleanup', () => {
    for (const body of [
      "try { it('charges a fee', 42); } finally { it('clears the ledger', () => {}); }",
      "try { it('charges a fee', 42); } catch (error) { throw error; }",
      "try { it('charges a fee', 42); } catch (error) {} finally { throw Error('feed unavailable'); }",
    ]) {
      const result = scanJasmine(`it('opens the market', () => {});\n${body}\nit('closes the desk', () => {});`);
      for (const test of result.tests)
        expect(test, body).toMatchObject({ state: 'notLoaded', stateSource: 'file', stateLine: 2 });
    }
  });

  it('uses registration order when a helper interrupts its containing suite', () => {
    const inventory = scanJasmine(`
function recordFill() { it('records a fill', () => {}); }
function rejectFee() { it('charges a fee', 42); }
describe('cash trades', () => {
  recordFill();
  rejectFee();
  recordFill();
  describe('at close', () => { it('posts interest', () => {}); });
});
describe('margin trades', () => { recordFill(); });
`);
    expect(inventory.tests.map((t) => [t.fullName, t.state, t.stateLine])).toEqual([
      ['cash trades > records a fill', 'active', null],
      ['cash trades > records a fill', 'notLoaded', 3],
      ['cash trades > at close > posts interest', 'notLoaded', 3],
      ['margin trades > records a fill', 'active', null],
    ]);
  });

  it('preserves earlier focus and isolates failures for each invocation of a named suite callback', () => {
    const inventory = scanJasmine(`
function checkBook() { it('opens the desk', () => {}); it('checks a fee', 42); fit('closes the desk', () => {}); }
fdescribe('cash book', checkBook);
describe('margin book', checkBook);
it('balances both books', () => {});
`);
    expect(Object.fromEntries(states(inventory).map(([name, ...state]) => [name, state]))).toEqual({
      'cash book > opens the desk': ['active', true],
      'cash book > closes the desk': ['notLoaded', false],
      'margin book > opens the desk': ['active', false],
      'margin book > closes the desk': ['notLoaded', false],
      'balances both books': ['active', false],
    });
  });

  it('collects recovery and cleanup specs on the paths Jasmine reaches', () => {
    for (const expandCases of [false, true]) {
      for (const [route, late] of [
        ['try { rejectFee(); lateQuote(); } catch (e) { recover(); } finally { clean(); }', 'active'],
        ['try { rejectFee(); lateQuote(); } finally { clean(); }', 'notLoaded'],
        ['try { rejectFee(); lateQuote(); } catch (e) { recover(); throw e; } finally { clean(); }', 'notLoaded'],
      ] as const) {
        const inventory = scanJasmine(
          `
function rejectFee() { it('charges a fee', 42); }
function lateQuote() { it('quotes a late price', () => {}); }
function recover() { it('recovers the trade', () => {}); }
function clean() { it('clears the ledger', () => {}); }
describe('order desk', () => { ${route} it('closes the desk', () => {}); });
it('balances both desks', () => {});
`,
          { expandCases },
        );
        expect(testNamed(inventory, 'quotes a late price').state, route).toBe('notLoaded');
        expect(testNamed(inventory, 'clears the ledger').state, route).toBe('active');
        expect(testNamed(inventory, 'closes the desk').state, route).toBe(late);
        expect(testNamed(inventory, 'balances both desks').state, route).toBe('active');
      }
    }
  });

  it('propagates only faults on paths that run during suite registration', () => {
    for (const [route, state] of [
      ['if (true) rejectFee();', 'notLoaded'],
      ['if (false) rejectFee();', 'active'],
      ['if (process.env.SETTLEMENT) rejectFee();', 'active'],
      ["for (const venue of ['lit']) rejectFee();", 'notLoaded'],
      ['for (const venue of []) rejectFee();', 'active'],
      ['for (const venue of venues) rejectFee();', 'active'],
      ['function chooseDesk() { if (false) return; rejectFee(); } chooseDesk();', 'notLoaded'],
      ['function chooseDesk() { if (true) return; rejectFee(); } chooseDesk();', 'active'],
      ['function chooseDesk() { return; rejectFee(); } chooseDesk();', 'active'],
      ['function chooseDesk() { rejectFee(); }', 'active'],
      ["it('checks the close', () => { throw Error('late quote'); });", 'active'],
    ]) {
      const inventory = scanJasmine(`
function rejectFee() { it('charges a fee', 42); }
describe('trades', () => { ${route} it('closes the desk', () => {}); });
`);
      expect(testNamed(inventory, 'closes the desk').state, route).toBe(state);
    }
    const late = scanJasmine(`
fdescribe('closing auction', () => {
  it('opens the desk', () => {});
  it('charges a fee', 42);
  beforeEach(() => pending());
  fdescribe('fees', () => { it('posts interest', () => {}); });
});`);
    expect(testNamed(late, 'opens the desk')).toMatchObject({
      isOnly: true,
      state: 'active',
      hooks: { beforeEach: 0 },
    });
    expect(testNamed(late, 'posts interest')).toMatchObject({
      isOnly: false,
      stateSource: 'suite',
      state: 'notLoaded',
    });
  });

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
