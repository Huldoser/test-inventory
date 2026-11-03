import type { ExpressionStatement } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/parse.ts';
import { Values } from '../src/values.ts';
import { PLAYWRIGHT_IMPORT, scanPlaywright, titles } from './helpers.ts';

/** Resolves the last statement of the code, which must be an expression, at the top level of the file. */
function resolve(code: string) {
  const parsed = parseFile('values.ts', code);
  const statement = parsed.program.body.at(-1) as ExpressionStatement;
  return new Values().resolve(statement.expression, [parsed.program]);
}

const UNRESOLVED = { ok: false, importedFrom: null };

describe('Values', () => {
  it.each([
    ["'AAPL';", 'AAPL'],
    ['187.5;', 187.5],
    ['true;', true],
    ['null;', null],
    ['undefined;', undefined],
    ["`${'NVDA'} closed at ${118.5}`;", 'NVDA closed at 118.5'],
    ["'TRD-' + 512;", 'TRD-512'],
    ['250 + 0.5;', 250.5],
    ['!false;', true],
    ['-25;', -25],
    ["[1, ...[2, 3], 'four'];", [1, 2, 3, 'four']],
    [
      "({ symbol: 'AAPL', 'side': 'buy', [`type`]: 'limit', 10: 'qty', ...{ tif: 'day' } });",
      { symbol: 'AAPL', side: 'buy', type: 'limit', 10: 'qty', tif: 'day' },
    ],
    ['const ORDER = { limits: [180, 190] };\nORDER.limits[1];', 190],
    ["const SIDE = 'buy';\nconst ORDER = { side: SIDE };\nORDER['side'];", 'buy'],
    ["('@smoke' as const);", '@smoke'],
    ["const tag = '@risk';\n(tag satisfies string);", '@risk'],
    ["const tag = '@risk';\ntag!;", '@risk'],
    ["enum Side { Buy = 'buy', Sell = 'sell' }\nSide.Sell;", 'sell'],
    ['enum Level { Low, Mid = 5, High }\nLevel.High;', 6],
    ["enum Quote { 'last price' = 'last', Bid = 'bid' }\nQuote['last price'] + Quote.Bid;", 'lastbid'],
    ['export const LIMIT = 100;\nLIMIT;', 100],
    ["const SIDE = 'sell';\nSIDE === 'sell' ? 'short' : 'long';", 'short'],
    ["const SIDE = 'buy';\nSIDE !== 'buy' ? 'short' : 'long';", 'long'],
    ["const LOTS = 3;\n`${LOTS > 1 ? 'lots' : 'lot'} ${LOTS >= 3} ${LOTS < 1} ${LOTS <= 3}`;", 'lots true false true'],
    ["'AAPL' < 'MSFT';", true],
    ['30 * 1000 - 500 / 2 + (7 % 4);', 29_753],
    ["const VENUE = '';\nVENUE || 'NASDAQ';", 'NASDAQ'],
    ["'NYSE' || price;", 'NYSE'],
    ["const DESK = 'fx';\nDESK && `${DESK} desk`;", 'fx desk'],
    ['0 && price;', 0],
    ["null ?? 'market';", 'market'],
    ["'limit' ?? price;", 'limit'],
    ['Object.keys({ buy: 1, sell: 2 });', ['buy', 'sell']],
    ["Object.values({ buy: 'B', sell: 'S' });", ['B', 'S']],
    ['Object.entries({ buy: 1 });', [['buy', 1]]],
    ["JSON.stringify({ symbol: 'AAPL', qty: 10 });", '{"symbol":"AAPL","qty":10}'],
    ['String(42.5);', '42.5'],
    ["'buy'.toUpperCase() + 'SELL'.toLowerCase() + ' gtc '.trim();", 'BUYsellgtc'],
    ["['AAPL', 'MSFT'].join(', ') + ['GTC', 'IOC'].join();", 'AAPL, MSFTGTC,IOC'],
    ["'NVDA'.length;", 4],
  ])('works out %s', (code, value) => {
    expect(resolve(code)).toEqual({ ok: true, value });
  });

  it.each([
    ['10n;'],
    ['/AAPL/;'],
    ['`${[1]}`;'],
    ['`${price}`;'],
    ['true + 1;'],
    ["[1] + 'a';"],
    ['price + 1;'],
    ['1 + price;'],
    ["-'a';"],
    ['typeof price;'],
    ['!price;'],
    ['[1, , 2];'],
    ["[...'ab'];"],
    ['[price];'],
    ['({ ...[1] });'],
    ['({ ...price });'],
    ['({ quote() {} });'],
    ['({ get last() { return 1; } });'],
    ['({ [price]: 1 });'],
    ['({ [{}]: 1 });'],
    ['({ last: price });'],
    ['let LIMIT = 100;\nLIMIT;'],
    ['function size() {}\nsize;'],
    ['class Order {}\nOrder;'],
    ['const a = b;\nconst b = a;\na;'],
    ['price;'],
    ["const ORDER = { side: 'buy' };\nORDER.qty;"],
    ['(1).toFixed;'],
    ["const ORDER = { side: 'buy' };\nORDER[side];"],
    ["const ORDER = { side: 'buy' };\nORDER[{}];"],
    ["enum Side { Buy = 'buy', Short = shortCode(), Cover }\nSide.Cover;"],
    ['enum Side { Buy = price }\nSide.Buy;'],
    ['price?.last;'],
    ["1 < 'a';"],
    ["'5' - 1;"],
    ['0 / 0;'],
    ["'buy' * 'sell';"],
    ['[1] === [1];'],
    ['1 == 1;'],
    ['price ? 1 : 2;'],
    ['price || 1;'],
    ['price === 1;'],
    ['1 === price;'],
    ['quote();'],
    ['quote.last();'],
    ['const Object = { keys: () => [] };\nObject.keys({});'],
    ['Object.keys({}, 1);'],
    ['Object.keys(price);'],
    ["Object.keys('ab');"],
    ['Object.freeze({});'],
    ['JSON.parse("1");'],
    ['String(price);'],
    ['String([1]);'],
    ['const String = (value) => value;\nString(1);'],
    ["'a'.toUpperCase?.();"],
    ["'a'.padStart(2);"],
    ["'a'.trim(1);"],
    ["'a'[`trim`]();"],
    ['price.trim();'],
    ['[[1]].join();'],
    ['[1].join(price);'],
    ['[1].join(1);'],
    ['[1].join(...seps);'],
    ['[1].concat([2]);'],
  ])('leaves %s unresolved', (code) => {
    expect(resolve(code)).toEqual(UNRESOLVED);
  });

  it('names the module of an imported value', () => {
    expect(resolve("import { TAGS } from './tags';\nTAGS.smoke;")).toEqual({ ok: false, importedFrom: './tags' });
    expect(resolve("import { a } from './a';\nconst b = { x: a };\nb.x;")).toEqual({ ok: false, importedFrom: './a' });
    expect(resolve("import { a } from './a';\n[a];")).toEqual({ ok: false, importedFrom: './a' });
    expect(resolve("import * as tags from './tags';\n`${tags.smoke}`;")).toEqual({ ok: false, importedFrom: './tags' });
  });

  it('reads parameters of every shape as names that hide constants', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
const SYMBOL = 'AAPL';
export default function quoteTests(...SYMBOL) {
  test(SYMBOL, async () => {});
}
function chartTests({ venue: SYMBOL = 'NYSE' }) {
  test(SYMBOL, async () => {});
}
class Feed {
  constructor(private readonly SYMBOL: string) {
    test(SYMBOL, async () => {});
  }
}
test(SYMBOL, async () => {});
`);
    expect(titles(inventory)).toEqual(['SYMBOL', 'SYMBOL', 'SYMBOL', 'AAPL']);
  });

  it('reads the arguments of the call a helper is walked at, where the call is', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
const VENUE = 'NASDAQ';
const SIDES = ['buy'];
function routeTests(side, { venue }, ...rest) {
  const title = \`routes a \${side} order\`;
  test(title, async () => {});
  test(\`to \${venue}\`, async () => {});
  test(\`with \${rest}\`, async () => {});
}
function venueTests(venue) {
  function sideTests() {
    test(\`\${venue} accepts market orders\`, async () => {});
  }
  sideTests();
}
function quoteTests(symbol) {
  test(\`quotes \${symbol}\`, async () => {});
}
routeTests('buy', { venue: VENUE }, 1);
routeTests(...SIDES);
venueTests(VENUE);
quoteTests();
`);
    expect(titles(inventory)).toEqual([
      'routes a buy order',
      'to NASDAQ',
      '`with ${rest}`',
      'title',
      '`to ${venue}`',
      '`with ${rest}`',
      'NASDAQ accepts market orders',
      '`quotes ${symbol}`',
    ]);
  });

  it('leaves a parameter the helper assigns to unknown, and gives an explicit undefined the default', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
function venueChecks(venue) {
  if (!venue) venue = 'NASDAQ';
  test.describe('venue', () => {
    test.skip(venue === 'NASDAQ', 'NASDAQ sandbox is down');
    test(\`routes to \${venue}\`, async () => {});
  });
}
function sideChecks(side) {
  side = side.toUpperCase();
  test(\`fills a \${side} order\`, async () => {});
}
function quantityChecks(lots) {
  lots++;
  test(\`fills \${lots} lots\`, async () => {});
}
function routingChecks(venue = 'NASDAQ', side = 'buy') {
  test.describe('routing', () => {
    test.skip(venue === 'NASDAQ', 'NASDAQ sandbox is down');
    test(\`routes a \${side} order to \${venue}\`, async () => {});
  });
}
venueChecks('');
sideChecks('buy');
quantityChecks(1);
routingChecks(undefined, 'sell');
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.condition])).toEqual([
      ['`routes to ${venue}`', 'skip', "venue === 'NASDAQ'"],
      ['`fills a ${side} order`', 'active', null],
      ['`fills ${lots} lots`', 'active', null],
      ['routes a sell order to NASDAQ', 'skip', null],
    ]);
  });

  it('leaves a constant unknown when the file changes it at the top level', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
const WATCHED = ['AAPL'];
WATCHED.push('MSFT');
const ROUTING = { market: 'NASDAQ' };
ROUTING.market = 'NYSE';
const LIMITS = { lots: 1 };
LIMITS.lots++;
const DESKS = { fx: 'FX' };
delete DESKS.fx;
const FEES = { retail: 25 };
Object.assign(FEES, { retail: 30 });
const SIDES = ['buy'];
const ORDER = { qty: 100 };
test.beforeEach(() => {
  SIDES.push('sell');
  ORDER.qty = 200;
});
for (const symbol of WATCHED) test(\`quotes \${symbol}\`, async () => {});
test(\`routes to \${ROUTING.market} with \${LIMITS.lots} lots, \${DESKS.fx} and \${FEES.retail}\`, async () => {});
test(\`fills \${SIDES.join()} for \${ORDER.qty}\`, async () => {});
`);
    expect(inventory.tests.map((test) => [test.title, test.caseCount])).toEqual([
      ['`quotes ${symbol}`', null],
      ['`routes to ${ROUTING.market} with ${LIMITS.lots} lots, ${DESKS.fx} and ${FEES.retail}`', null],
      ['fills buy for 100', null],
    ]);
  });

  it('skips declarations without a name', () => {
    expect(resolve("export default class {}\nconst VENUE = 'NYSE';\nVENUE;")).toEqual({ ok: true, value: 'NYSE' });
    expect(resolve("export default function () {}\nconst VENUE = 'NYSE';\nVENUE;")).toEqual({
      ok: true,
      value: 'NYSE',
    });
  });

  it('caches constants and reuses them', () => {
    const parsed = parseFile('values.ts', "const SYMBOL = 'AAPL';\nSYMBOL;\nSYMBOL;");
    const values = new Values();
    const [, first, second] = parsed.program.body as ExpressionStatement[];
    expect(values.resolve(first.expression, [parsed.program])).toEqual({ ok: true, value: 'AAPL' });
    expect(values.resolve(second.expression, [parsed.program])).toEqual({ ok: true, value: 'AAPL' });
  });

  it('resolves names in the scope where the test is declared, inner scopes first', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
const SYMBOL = 'AAPL';
namespace Venues {
  const VENUE = 'NASDAQ';
  test(VENUE, async () => {});
}
test.describe('quotes', () => {
  const SYMBOL = 'MSFT';
  test(SYMBOL, async () => {});
  for (const SYMBOL of ['NVDA']) test(SYMBOL, async () => {});
  for (let index = 0, SYMBOL = 'X'; index < 1; index++) test(SYMBOL, async () => {});
  for (const key in { a: 1 }) test(key, async () => {});
  try {} catch (SYMBOL) { test(SYMBOL, async () => {}); }
  ((SYMBOL) => test(SYMBOL, async () => {}))('TSLA');
  class Feed { static { const SYMBOL = 'AMZN'; test(SYMBOL, async () => {}); } }
});
export default function venueTests() {}
`);
    expect(titles(inventory)).toEqual(['NASDAQ', 'MSFT', 'SYMBOL', 'SYMBOL', 'key', 'SYMBOL', 'SYMBOL', 'AMZN']);
  });
});
