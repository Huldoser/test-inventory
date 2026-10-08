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
    ['5 - 1;'],
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
    ["enum Side { Buy = 'buy', Short = 'sell'.length, Cover }\nSide.Cover;"],
    ['enum Side { Buy = price }\nSide.Buy;'],
    ['price?.last;'],
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
