import type { ExpressionStatement } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/parse.ts';
import { Values } from '../src/values.ts';
import { PLAYWRIGHT_IMPORT, scanPlaywright, scanVitest, titles, VITEST_IMPORT } from './helpers.ts';

/** Resolves the last statement of the code, which must be an expression, at the top level of the file. */
function resolve(code: string) {
  const parsed = parseFile('values.ts', code);
  const statement = parsed.program.body.at(-1) as ExpressionStatement;
  return new Values().resolve(statement.expression, [parsed.program]);
}

const UNRESOLVED = { ok: false, importedFrom: null };

describe('Values', () => {
  it('uses the final static name field and ignores instance, unrelated and private fields', () => {
    expect(
      resolve(`class Desk {
      name = "paper"; static venue = "closing"; static #name = "reserve";
    } Desk.name;`),
    ).toEqual({ ok: true, value: 'Desk' });
    expect(resolve('class Desk { static name; } Desk.name;')).toEqual({ ok: true, value: undefined });
    expect(resolve('class Desk { static { register(this); } static name = "late"; } Desk.name;')).toEqual({
      ok: true,
      value: 'late',
    });
  });

  it('leaves runtime class and function names unresolved after a possible change', () => {
    for (const code of [
      'class Desk { static name = "paper"; static { register(this); } } Desk.name;',
      'class Desk { static [key()] = "night"; } Desk.name;',
      'class Desk { static get name() { return selectDesk(); } } Desk.name;',
      'class Desk {} Object.defineProperty(Desk, "name", settings); Desk.name;',
      'function postOrder() {} Object.defineProperty(postOrder, "name", settings); postOrder.name;',
    ])
      expect(resolve(code)).toEqual(UNRESOLVED);
  });

  it('resolves declared class data properties in JavaScript initialization order', () => {
    for (const [code, value] of [
      ['class Desk { static { this.window = "opening"; } static window = "closing"; } Desk.window;', 'closing'],
      ['class Desk { static window; } Desk.window;', undefined],
      ['class Desk { static name() {} } Desk.name.name;', 'name'],
      ['class Desk { static open() {} declare static open: () => void; } Desk.open.name;', 'open'],
      ['class Desk { settle() {} static settle = "closing"; } Desk.prototype.settle.name;', 'settle'],
    ] as const)
      expect(resolve(code)).toEqual({ ok: true, value });
  });

  it('leaves class titles unknown when a getter, decorator, static block or write determines them', () => {
    for (const code of [
      'class Desk { static get window() { return currentWindow(); } } Desk.window;',
      'class Desk { static window = "opening"; static { this.window = currentWindow(); } } Desk.window;',
      'class Desk { settle() {} static { this.prototype.settle = chooseMethod(); } } Desk.prototype.settle.name;',
      'class Desk { static open() {} static [currentWindow()]() {} } Desk.open.name;',
      'class Desk { static open() {} static [currentWindow()] = "opening"; } Desk.open.name;',
      '@chooseDesk class Desk { static open() {} } Desk.open.name;',
      'class Desk { @chooseMethod static open() {} } Desk.open.name;',
      'class Desk { static accessor window = "opening"; } Desk.window;',
      'class Desk { static window = "opening"; } Desk.window = currentWindow(); Desk.window;',
      'class Desk {} Desk.prototype.prototype;',
    ])
      expect(resolve(code)).toEqual(UNRESOLVED);
  });

  it('reads inherited properties until a derived class supplies its own definition', () => {
    expect(resolve('class Book extends (class { static desk = "closing"; }) {} Book.desk;')).toEqual({
      ok: true,
      value: 'closing',
    });
    expect(resolve('class Venue {static desk = "closing"} class Book extends Venue {static desk;} Book.desk;')).toEqual(
      { ok: true, value: undefined },
    );
    expect(resolve('class Book { ["constructor"]() {} constructor() {} } Book.prototype.constructor.name;')).toEqual({
      ok: true,
      value: 'constructor',
    });
    expect(resolve('(class {}).prototype.constructor.name;')).toEqual({ ok: true, value: '' });
    for (const code of [
      'class Venue { static desk = "opening"; } class Book extends Venue { static get desk() { return currentWindow(); } } Book.desk;',
      'class Venue { static desk = "opening"; } Venue.desk = currentWindow(); class Book extends Venue {} Book.desk;',
      'class Book extends selectVenue() {} Book.desk;',
      'const tables = {}; class Book extends tables.Venue {} Book.desk;',
      'class Book extends Book {} Book.desk;',
    ])
      expect(resolve(code)).toEqual(UNRESOLVED);
  });

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
    ["Object.keys({ ...{ ['__proto__']: null }, desk: 'cash' });", ['__proto__', 'desk']],
    ["Object.keys({ __proto__: 'desk', fee: 7 });", ['fee']],
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
    ['+({ toString: null, valueOf: null });'],
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

  it('leaves a constant unknown when code that runs while the file loads changes it, also through an alias', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { DESKS } from './desks';
const VENUES = ['NYSE'];
const SIDES = ['buy'];
const TIERS = ['retail'];
const LIMITS = { lots: 1 };
const register = (venue) => VENUES.push(venue);
const all = SIDES;
all.push('sell');
DESKS.push('rates');
function addTier(list) {
  list.push('professional');
  test(\`lists \${list.length} tiers\`, () => {});
}
describe('routing', () => {
  register('IEX');
  TIERS.push('market maker');
  const BOOKS = ['equities'];
  BOOKS.push('fx');
  for (const book of BOOKS) test(\`books \${book}\`, () => {});
});
test('fills an order', () => {
  LIMITS.lots = 2;
});
for (const venue of VENUES) test(\`routes to \${venue}\`, () => {});
for (const side of SIDES) test(\`places a \${side} order\`, () => {});
for (const tier of TIERS) test(\`charges \${tier}\`, () => {});
for (const desk of DESKS) test(\`books to \${desk}\`, () => {});
addTier(['retail']);
test(\`trades \${LIMITS.lots} lot\`, () => {});
`);
    expect(inventory.tests.map((test) => [test.title, test.caseCount])).toEqual([
      ['`books ${book}`', null],
      ['fills an order', null],
      ['`routes to ${venue}`', null],
      ['`places a ${side} order`', null],
      ['`charges ${tier}`', null],
      ['`books to ${desk}`', null],
      ['`lists ${list.length} tiers`', null],
      ['trades 1 lot', null],
    ]);
  });

  it('marks titles dynamic when writes through member aliases or destructuring change the original object', () => {
    const prefix = 'const book = { desk: { label: "opening auction", rows: ["open"] } };';
    for (const setup of [
      'const desk = book.desk;',
      'const first = book["desk"]; const desk = first;',
      'const { desk } = book;',
      'const { desk: window } = book; const desk = window;',
      'const { book: { desk } } = { book };',
      'const { desk } = { desk: book.desk };',
      'const [desk] = [book.desk];',
    ]) {
      const result = scanVitest(
        `${VITEST_IMPORT}\n${prefix}\n${setup}\ndesk.label = "closing auction"; test(book.desk.label, () => {});`,
      );
      expect(result.tests.map((test) => [test.title, test.hasDynamicTitle])).toEqual([['book.desk.label', true]]);
    }
    expect(
      resolve(
        'const desks=[{label:"opening auction"}]; const [desk]=desks; desk.label="closing auction"; desks[0].label;',
      ),
    ).toEqual(UNRESOLVED);
    expect(resolve(prefix + ' const rows = book.desk.rows; rows.push("close"); book.desk.rows.join(" and ");')).toEqual(
      UNRESOLVED,
    );
  });

  it('preserves the original title after a shallow copy is changed or a test body updates an alias', () => {
    const prefix = 'const book = { desk: { label: "opening auction" } };';
    for (const setup of [
      'const desk = {...book.desk}; desk.label = "closing auction";',
      'const {...desk} = book.desk; desk.label = "closing auction";',
      'const desk = book.desk; test("closes the market", () => { desk.label = "closing auction"; });',
    ])
      expect(resolve(prefix + setup + 'book.desk.label;')).toEqual({ ok: true, value: 'opening auction' });
  });

  it('tracks writes and deletes through optional chains, including the source of an alias', () => {
    const prefix = 'const book={desk:{label:"opening auction"}};';
    for (const change of [
      'const desk=book?.desk; desk.label="closing auction";',
      'const copy={desk:book?.desk}; copy.desk.label="closing auction";',
      'Object.assign(book?.desk, {label:"closing auction"});',
      'delete book.desk?.label;',
      'delete (book?.desk.label);',
    ])
      expect(resolve(prefix + change + 'book.desk.label;')).toEqual(UNRESOLVED);
    expect(resolve(prefix + 'const desk=book?.desk; desk?.label; book.desk.label;')).toEqual({
      ok: true,
      value: 'opening auction',
    });
  });

  it('tracks the declaration a mutated alias belongs to when nested scopes reuse a name', () => {
    const prefix = 'const morning={desk:{label:"opening auction"}}; const evening={desk:{label:"midday auction"}};';
    const update = '{const desk=morning.desk; void desk;} {const desk=evening.desk; desk.label="closing auction";}';
    expect(resolve(prefix + update + 'morning.desk.label;')).toEqual({ ok: true, value: 'opening auction' });
    expect(resolve(prefix + update + 'evening.desk.label;')).toEqual(UNRESOLVED);
    for (const body of [
      '{const morning={desk:{label:"paper"}}; morning.desk.label="closing auction";}',
      'function adjust(morning){morning.label="closing auction";} adjust(evening.desk);',
      'const desk=morning.desk; function adjust(){if(true){var desk=evening.desk;} desk.label="closing auction";} adjust();',
    ])
      expect(resolve(prefix + body + 'morning.desk.label;')).toEqual({ ok: true, value: 'opening auction' });
  });

  it('keeps an ambient literal declaration out of runtime mutation tracking', () => {
    const code = 'declare const auctionPhase = "opening"; const display = {label:auctionPhase};';
    expect(resolve(code + 'Object.assign(globalThis, {auctionPhase:"closing"}); display.label;')).toEqual(UNRESOLVED);
  });

  it('tracks the object an assigned alias holds at a write and when another alias captures it', () => {
    const setup =
      'const opening={desk:{label:"opening"}}; const evening={desk:{label:"evening"}}; let desk=opening.desk;';
    for (const assign of [
      'desk=evening.desk;',
      '({desk}=evening);',
      '[desk]=[evening.desk];',
      '[desk=evening.desk]=[];',
    ]) {
      const code = setup + assign + 'desk.label="closing";';
      expect(resolve(code + 'evening.desk.label;')).toEqual(UNRESOLVED);
      expect(resolve(code + 'opening.desk.label;')).toEqual({ ok: true, value: 'opening' });
    }
    for (const capture of [
      'desk.label="closing"; desk=evening.desk;',
      'const copy=desk; desk=evening.desk; copy.label="closing";',
    ]) {
      expect(resolve(setup + capture + 'evening.desk.label;')).toEqual({ ok: true, value: 'evening' });
      expect(resolve(setup + capture + 'opening.desk.label;')).toEqual(UNRESOLVED);
    }
    const chain = setup + 'let other; other=desk=evening.desk; other.label="closing";';
    expect(resolve(chain + 'evening.desk.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + 'desk=evening.desk; desk={}; desk.label="closing"; evening.desk.label;')).toEqual({
      ok: true,
      value: 'evening',
    });
  });

  it('keeps the source of an alias readable when its assignment branch is unreachable', () => {
    const code = 'const book={label:"opening"}; let desk={};';
    for (const branch of ['if(false) desk=book;', 'if(true) { desk={}; } else { desk=book; }']) {
      expect(resolve(code + branch + 'desk.label="closing"; book.label;')).toEqual({ ok: true, value: 'opening' });
    }
    expect(resolve(code + 'if(false) {} else { desk=book; } desk.label="closing"; book.label;')).toEqual(UNRESOLVED);
  });

  it('reads a helper at each call through a chain of local constants in its declaration scope', () => {
    const inventory = scanVitest(
      VITEST_IMPORT +
        `
      const venue="primary";
      function register(label){test(venue+" "+label,()=>{});}
      const first=register; {const venue="reserve"; const post=first;post("open");post("close");}
    `,
    );
    expect(titles(inventory)).toEqual(['primary open', 'primary close']);
  });

  it('follows writes made through a constant function alias without confusing a shadowed helper', () => {
    const code = 'const book={label:"opening"};function close(desk){desk.label="closing";}';
    expect(resolve(code + 'const apply=close;const publish=apply;publish(book);book.label;')).toEqual(UNRESOLVED);
    expect(resolve(code + '{const close=desk=>desk.label;const apply=close;apply(book);} book.label;')).toEqual({
      ok: true,
      value: 'opening',
    });
    const cycle = parseFile('helpers.ts', 'const first=second;const second=first;');
    expect(new Values().functionOf('first', [cycle.program])).toBeNull();
  });

  it('pairs the function passed to a dispatcher with the data from that call', () => {
    const setup =
      'const day={label:"day"}; const night={label:"night"}; function inspect(desk){return desk.label;} function close(desk){desk.label="closing";}';
    for (const calls of [
      'function run(fn,desk){fn(desk);}run(inspect,day);run(close,night);',
      'function run({fn,desk}){fn(desk);}run({fn:close,desk:night});run({fn:inspect,desk:day});',
      'function run(desk,fn=close){fn(desk);}run(day,inspect);run(night);',
      'function apply(fn,desk){fn(desk);}function run(fn,desk){apply(fn,desk);}run(close,night);run(inspect,day);',
      'function run(fn,desk){fn(desk);}run(desk=>{desk.label="closing";},night);',
    ]) {
      expect(resolve(setup + calls + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + calls + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
    const deferred = 'function run(fn,desk){test("late close",()=>fn(desk));}run(close,day);';
    expect(resolve(setup + deferred + 'day.label;')).toEqual({ ok: true, value: 'day' });
  });

  it('resolves a constant alias of a callback in the scope that captured the parameter', () => {
    const code =
      'const day={label:"day"};const night={label:"night"};function inspect(desk){return desk.label;}function close(desk){desk.label="closing";}';
    const run =
      'function run(fn,desk){const first=fn;const apply=first;{const fn=inspect;apply(desk);}}run(inspect,day);run(close,night);';
    expect(resolve(code + run + 'night.label;')).toEqual(UNRESOLVED);
    expect(resolve(code + run + 'day.label;')).toEqual({ ok: true, value: 'day' });
  });

  it('tracks functions selected by expressions while preserving an applicable default callback', () => {
    const setup =
      'const desk={label:"opening"};function close(row){row.label="closing";}function inspect(row){return row.label;}';
    for (const choice of ['flip()?close:inspect', '(inspect,close)', 'null??close', 'true?close:inspect']) {
      expect(resolve(setup + 'const task=' + choice + ';function run(fn){fn(desk);}run(task);desk.label;')).toEqual(
        UNRESOLVED,
      );
    }
    for (const choice of ['false?close:inspect', '(close,inspect)']) {
      expect(resolve(setup + 'const task=' + choice + ';function run(fn){fn(desk);}run(task);desk.label;')).toEqual({
        ok: true,
        value: 'opening',
      });
    }
    const mayBeMissing =
      'function run(fn=close){fn(desk);}function outer(fn){run(fn);}outer(flip()?inspect:undefined);';
    expect(resolve(setup + mayBeMissing + 'desk.label;')).toEqual(UNRESOLVED);
  });

  it('tracks a callback supplied by an assignment expression and stops on circular callable aliases', () => {
    const setup = 'const desk={label:"opening"};function close(row){row.label="closing";}function run(fn){fn(desk);}';
    expect(resolve(setup + 'let edit;run(edit=close);desk.label;')).toEqual(UNRESOLVED);
    const cycle = 'function route(active){if(active){const first=second;const second=first;run(second);}}route(false);';
    expect(resolve(setup + cycle + 'desk.label;')).toEqual({ ok: true, value: 'opening' });
  });

  it('includes every possible callback when a computed property can override a named one', () => {
    const setup =
      'const desk={label:"opening"}; function close(row){row.label="closing";} function inspect(row){return row.label;} function run({task},row){task(row);}';
    for (const options of [
      '{task:inspect,[getKey()]:close}',
      '{task:close,[getKey()]:inspect}',
      '{task:close,[getKey()]:close}',
    ])
      expect(resolve(setup + 'run(' + options + ',desk);desk.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + 'run({[getKey()]:close,task:inspect},desk);desk.label;')).toEqual({
      ok: true,
      value: 'opening',
    });
  });

  it('traces a returned callback result through the dispatcher that provided its function', () => {
    const setup = 'const day={label:"day"};const night={label:"night"};function run(fn,desk){return fn(desk);}';
    const code =
      setup +
      'function pick(desk){return desk;} function fallback(){return day;} run(fallback,day);run(pick,night).label="closing";';
    expect(resolve(code + 'night.label;')).toEqual(UNRESOLVED);
    expect(resolve(code + 'day.label;')).toEqual({ ok: true, value: 'day' });
  });

  it('tracks the arguments of local functions invoked with call, apply and Reflect.apply', () => {
    const setup =
      'const day={label:"day"};const night={label:"night"};function close(row){row.label="closing";}function read(row){return row.label;}';
    for (const invocation of [
      'close.call(null,night);',
      'close.apply(undefined,[night]);',
      'Reflect.apply(close,null,[night]);',
      'const entries=[night];close.apply(null,entries);',
      'function apply(fn,row){fn.call(null,row);}apply(read,day);apply(close,night);',
      'function apply(fn,...rows){fn.call(null,...rows);}apply(read,day);apply(close,night);',
      'function closeSecond(first,row){row.label="closing";}closeSecond.apply(null,[,night]);',
    ]) {
      expect(resolve(setup + invocation + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + invocation + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
    expect(resolve(setup + '{const Reflect={apply:()=>{}};Reflect.apply(close,null,[night]);}night.label;')).toEqual({
      ok: true,
      value: 'night',
    });
  });

  it('follows the explicit receiver and objects returned by call and apply', () => {
    const setup =
      'const desk={label:"opening"};function pick(row){return row;}function update(){this.label="closing";}';
    for (const call of [
      'pick.call(null,desk).label="closing";',
      'pick.apply(null,[desk]).label="closing";',
      'update.call(desk);',
      'Reflect.apply(update,desk,[]);',
    ])
      expect(resolve(setup + call + 'desk.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + 'const receiver=()=>this;receiver.call(desk).label="closing"; desk.label;')).toEqual({
      ok: true,
      value: 'opening',
    });
  });

  it('honors a function’s own call method and restores the inherited method after deletion', () => {
    const setup =
      'const desk={label:"opening"};function close(row){row.label="closing";}function read(row){return row.label;}';
    const idle = 'const alias=close;alias.call=()=>{};';
    expect(resolve(setup + idle + 'close.call(null,desk);desk.label;')).toEqual({ ok: true, value: 'opening' });
    expect(resolve(setup + idle + 'delete close.call;close.call(null,desk);desk.label;')).toEqual(UNRESOLVED);
    expect(
      resolve(setup + 'read.call=(receiver,row)=>{row.label="closing";};read.call(null,desk);desk.label;'),
    ).toEqual(UNRESOLVED);
    expect(resolve(setup + 'close.call(null,desk);close.call=()=>{};desk.label;')).toEqual(UNRESOLVED);
  });

  it('uses the identity of a mutable function alias when its own method is set before reassignment', () => {
    const setup =
      'const desk={label:"opening"};function close(row){row.label="closing";}function read(row){return row.label;}';
    expect(resolve(setup + 'let alias=close;alias.call=()=>{};alias=read;close.call(null,desk);desk.label;')).toEqual({
      ok: true,
      value: 'opening',
    });
    expect(resolve(setup + 'let alias=close;alias=read;alias.call=()=>{};close.call(null,desk);desk.label;')).toEqual(
      UNRESOLVED,
    );
  });

  it('keeps method alternatives when a write may replace either of two functions', () => {
    const setup =
      'const desk={label:"opening"};function close(row){row.label="closing";}function read(row){return row.label;}';
    for (const override of [
      '(globalThis.fast?close:read).call=()=>{};',
      'if(globalThis.fast)close.call=()=>{};',
      'const other=read;other.call=()=>{};',
    ])
      expect(resolve(setup + override + 'close.call(null,desk);desk.label;')).toEqual(UNRESOLVED);
    const own = 'const other=close;read.call=function(receiver,row){row.label="closing";};';
    expect(resolve(setup + own + 'read.call(null,desk);desk.label;')).toEqual(UNRESOLVED);
  });

  it('applies defaults and empty rest parameters when an invocation omits its argument list', () => {
    const setup = 'const desk={label:"opening"};function update(row=desk,...others){row.label="closing";}';
    expect(resolve(setup + 'update.apply();desk.label;')).toEqual(UNRESOLVED);
    const read = 'function inspect(...rows){return rows.length;}inspect.call();inspect.apply();';
    expect(resolve(setup + read + 'try {Reflect.apply();} catch {} desk.label;')).toEqual({
      ok: true,
      value: 'opening',
    });
  });

  it('selects the Reflect.apply target and receiver from literal argument spreads', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    for (const route of [
      'Reflect.apply(...[close,null,[night]]);',
      'Reflect.apply(...[],...[...[],close],null,[night]);',
      'function update(){this.label="closed";}Reflect.apply(...[update,night,[]]);',
      'function dispatch(fn,row){Reflect.apply(...[fn,null,[row]]);}dispatch(read,day);dispatch(close,night);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
    expect(resolve(setup + 'Reflect.apply(...[read],close,[day]);day.label;')).toEqual({ ok: true, value: 'day' });
    expect(resolve(setup + 'try {Reflect.apply(...[,close,null,[day]]);} catch {} day.label;')).toEqual({
      ok: true,
      value: 'day',
    });
  });

  it('tracks the function and receiver supplied to Reflect.apply by a named argument array', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    for (const route of [
      'const items=[close,null,[night]],alias=items;Reflect.apply(...alias);',
      'const prefix=[close,null];Reflect.apply(...prefix,[night]);',
      'const desk=night,items=[close,null,[desk]];{const desk=day;Reflect.apply(...items);}',
      'function update(){this.label="closed";}const items=[update,night,[]];Reflect.apply(...items);',
      'const items=[read,null,[night]],alias=items;alias[0]=close;Reflect.apply(...items);',
      'const items=[close,null,[night]];Reflect.apply(...items);items[0]=read;',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
    const replaced = 'const items=[close,null,[night]];items[0]=read;Reflect.apply(...items);';
    expect(resolve(setup + replaced + 'night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('reads the Reflect.apply receiver and argument list as they stand at the call', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    for (const route of [
      'const items=[close,null,[day]];items[2]=[night];Reflect.apply(...items);',
      'const rows=[day],items=[close,null,rows];rows[0]=night;Reflect.apply(...items);',
      'function update(){this.label="closed";}const items=[update,day,[]];items[1]=night;Reflect.apply(...items);',
      'const items=[close,null,[night]];Reflect.apply(...items);items[2]=[day];',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('follows a forwarded Reflect.apply list and uses a default for a deleted array entry', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row=night){row.label="closed";}';
    for (const route of [
      'function dispatch(rows){Reflect.apply(close,null,rows);}dispatch([night]);',
      'const rows=[day],items=[close,null,rows];delete rows[0];Reflect.apply(...items);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
    const conditional =
      'const active=true,items=[close,null,[day]];if(active)items[2]=[night];Reflect.apply(...items);';
    expect(resolve(setup + conditional + 'night.label;')).toEqual(UNRESOLVED);
  });

  it('uses values captured by array spread while preserving shared nested argument arrays', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    for (const route of [
      'const items=[close,null,[night]],copy=[...items];items[0]=read;Reflect.apply(...copy);',
      'const rows=[night],items=[close,null,[...rows]];rows[0]=day;Reflect.apply(...items);',
      'const rows=[day],items=[close,null,rows],copy=[...items];rows[0]=night;Reflect.apply(...copy);',
      'const items=[read,null,[night]];items[0]=close;const copy=[...items];items[0]=read;Reflect.apply(...copy);',
      'const items=[close,null,[night]];function copy(){return [...items];}const saved=copy();items[0]=read;Reflect.apply(...saved);',
      'const rows=[day];function dispatch(){const copied=[...rows];Reflect.apply(close,null,copied);}rows[0]=night;dispatch();',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('reads the reordered receiver and arguments after a local array is edited', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    for (const route of [
      'const items=[close,null];items.push([night]);Reflect.apply(...items);',
      'const items=[null,[night]];items.unshift(close);Reflect.apply(...items);',
      'const items=[read,close,null,[night]];items.shift();Reflect.apply(...items);',
      'const items=[read,null,[night]];items.splice(0,1,close);const copy=[...items];items[0]=read;Reflect.apply(...copy);',
      'const rows=[day];rows.splice(-1,1,night);Reflect.apply(close,null,rows);',
      'const rows=[day,night];rows.reverse();Reflect.apply(close,null,rows);',
      'const rows=[day,night];rows.copyWithin(0,1);Reflect.apply(close,null,rows);',
      'const rows=[day];rows.fill(night);Reflect.apply(close,null,rows);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('keeps unrelated slots out of sparse arrays after their length or a distant index changes', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    for (const route of [
      'const rows=[night];rows.length=4000000000;rows.push(day);Reflect.apply(close,null,[rows[0]]);',
      'const rows=[];rows[4000000000]=day;rows.unshift(night);Reflect.apply(close,null,[rows[0]]);',
      'const rows=[night];rows.length=128;rows.push(day);Reflect.apply(close,null,rows);',
      'const rows=[];rows[64]=day;rows.unshift(night);Reflect.apply(close,null,rows);',
    ]) {
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
    }
  });

  it('uses parameter defaults for array entries removed, cleared or left as holes', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row=night){row.label="closed";}';
    for (const edits of [
      'rows.pop();',
      'rows.splice(0);',
      'rows.fill();',
      'rows.length=0;rows.reverse();',
      'delete rows[0];rows.reverse();',
    ]) {
      const run = setup + 'const rows=[day];' + edits + 'Reflect.apply(close,null,rows);';
      expect(resolve(run + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(run + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('tracks inserted or moved rows when array offsets, spreads or execution order are unknown', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},unchanged={label:"other"};function close(row){row.label="closed";}function zero(){return 0;}function one(){return 1;}';
    for (const edits of [
      'const rows=[day];rows.splice(zero(),1,night);',
      'const rows=[day];rows.splice(0,one(),night);',
      'const rows=[day];rows.fill(night,zero());',
      'const rows=[day];rows.fill(night,0,one());',
      'const rows=[day,night];rows.copyWithin(zero(),1);',
      'const rows=[day,night];rows.copyWithin(0,one());',
      'const rows=[day,night];rows.copyWithin(0,1,one()+1);',
      'const rows=[day,night];rows.sort((a,b)=>a===night?-1:1);',
      'const rows=[],add=[night];rows.push(...add);',
      'const rows=[day],args=[0,1,night];rows.splice(...args);',
      'const rows=[day],add=[night];rows.splice(0,1,...add);',
      'const rows=[day];if(one())rows[0]=night;rows.reverse();',
      'const rows=[day];rows[zero()]=night;rows.reverse();',
      'const rows=[day];rows.length=zero();rows.push(night);',
      'const rows=[day];function prepare(){rows.unshift(night);}prepare();',
      'const rows=[night];rows.label="quotes";if(one())delete rows.label;rows.reverse();',
    ]) {
      const run = setup + edits + 'Reflect.apply(close,null,rows);';
      expect(resolve(run + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(run + 'unchanged.label;')).toEqual({ ok: true, value: 'other' });
    }
  });

  it('honors array method overrides, deletion and writes following a read', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    for (const route of [
      'const rows=[night];rows.unshift=()=>{};rows.unshift(day);Reflect.apply(close,null,rows);',
      'const rows=[day];rows.unshift=()=>{};rows.unshift(day);delete rows.unshift;rows.unshift(night);Reflect.apply(close,null,rows);',
      'const rows=[night];Reflect.apply(close,null,rows);rows.unshift(day);',
      'const rows=[day,night];rows.copyWithin(0,1,2);rows.fill(day,1,2);Reflect.apply(close,null,rows);',
      'const data=[night],rows=[...data];rows.push(day);Reflect.apply(close,null,rows);',
      'const add=[night];const rows=[...[],...add];rows.splice(1,0,day);Reflect.apply(close,null,rows);',
      'const rows=[night,day];rows.reverse();Reflect.apply(close,null,[rows[1]]);',
      'const rows=[];rows[0]=night;rows.push(day);Reflect.apply(close,null,rows);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('reads unaffected slots across copies, sparse growth and repeated invocations', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row=night){row.label="closed";}';
    for (const route of [
      'const rows=[night,day,day];rows.copyWithin(1,2);Reflect.apply(close,null,rows);',
      'const rows=[night,day];rows[1]=day;rows.reverse();rows.reverse();Reflect.apply(close,null,rows);',
      'const extras=[],rows=[...extras,night];rows.reverse();Reflect.apply(close,null,rows);Reflect.apply(close,null,rows);',
      'const rows=[];rows.length=1;rows.reverse();Reflect.apply(close,null,rows);',
      'const prefix=[night];const bound=close.bind(null,...prefix);Reflect.apply(bound,null,[]);',
      'const desks={post:night};Reflect.apply(close,null,[desks.post]);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('follows potential rows from unknown spread lengths and computed indices', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},other={label:"other"};function close(row){row.label="closed";}';
    for (const route of [
      'function list(){return [night];}const rows=[...list()];rows.unshift(night);Reflect.apply(close,null,rows);',
      'const base=[day];base[0]=night;const rows=[...base];rows.unshift(night);Reflect.apply(close,null,rows);',
      'const base=[night];base.reverse();const rows=[...base];rows.unshift(night);Reflect.apply(close,null,rows);',
      'const nested=[night],base=[...nested],rows=[...base];rows.unshift(night);Reflect.apply(close,null,rows);',
      'const rows=[day,night],key=0;rows.reverse();Reflect.apply(close,null,[rows[key]]);',
      'const rows=[night];function tweak(){rows.push(day);}Reflect.apply(close,null,rows);rows.shift();',
      'const rows=[night];function tweak(){rows.push(day);}function dispatch(){Reflect.apply(close,null,rows);}[0].forEach(dispatch);rows.reverse();',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'other.label;')).toEqual({ ok: true, value: 'other' });
    }
  });

  it('follows edits to argument arrays in direct, applied, bound and returned calls', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}const rows=[day];rows.unshift(night);';
    for (const route of [
      'close(rows[0]);',
      'close.call(null,rows[0]);',
      'close.apply(null,rows);',
      'const chosen=rows[0];close(chosen);',
      'function choose(){return rows[0];}close(choose());',
      'function edit(){this.label="closed";}edit.call(rows[0]);',
      'const edit=close.bind(null,rows[0]);rows.shift();edit();',
      'function invoke(fn,row){fn(row);}invoke(close,rows[0]);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
    const early =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}const rows=[day],edit=close.bind(null,rows[0]);rows.unshift(night);edit();';
    expect(resolve(early + 'night.label;')).toEqual({ ok: true, value: 'night' });
    expect(resolve(early + 'day.label;')).toEqual(UNRESOLVED);
  });

  it('follows a helper replacing the callback in an argument array before collection', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}const args=[read,null,[night]];function prepare(list,fn){list[0]=fn;}';
    expect(resolve(setup + 'prepare(args,close);Reflect.apply(...args);night.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + 'prepare(args,close);Reflect.apply(...args);day.label;')).toEqual({
      ok: true,
      value: 'day',
    });
    for (const control of [
      'Reflect.apply(...args);prepare(args,close);',
      'prepare([read],close);Reflect.apply(...args);',
      'prepare(args,close);prepare(args,read);Reflect.apply(...args);',
      'test("closes the exchange",()=>prepare(args,close));Reflect.apply(...args);',
    ])
      expect(resolve(setup + control + 'night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('orders slot assignments, deletions and array edits made by local setters', () => {
    const setup =
      'const desk={label:"day"};function close(row){row.label="closed";}function read(row){return row.label;}const handlers=[read,read];';
    const insert = 'const replace=list=>(list[0]=close);handlers.unshift(read);replace(handlers);';
    expect(resolve(setup + insert + 'handlers[0](desk);desk.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + insert + 'handlers[1](desk);desk.label;')).toEqual({ ok: true, value: 'day' });
    const remove = 'handlers[0]=close;function drop(list){delete list[0];}drop(handlers);handlers[0]?.(desk);';
    expect(resolve(setup + remove + 'desk.label;')).toEqual({ ok: true, value: 'day' });
    const both = 'function replace(list){list[0]=close;list[1]=read;}replace(handlers);';
    expect(resolve(setup + both + 'handlers[0](desk);desk.label;')).toEqual(UNRESOLVED);
    const local = 'function replace(list){list=[read];list[0]=close;}replace(handlers);';
    expect(resolve(setup + local + 'handlers[0](desk);desk.label;')).toEqual({ ok: true, value: 'day' });
  });

  it('uses the final synchronous replacement and delays an async setter past its await', () => {
    const setup =
      'const row={label:"night"},handlers=[];function close(desk){desk.label="closed";}function read(desk){return desk.label;}handlers[0]=read;';
    for (const setter of [
      'function set(list){list[0]=close;list[0]=read;}',
      'async function set(list){await Promise.resolve();list[0]=close;}',
    ]) {
      expect(resolve(setup + setter + 'set(handlers);handlers[0](row);row.label;')).toEqual({
        ok: true,
        value: 'night',
      });
    }
    const synchronous = 'async function set(list){list[0]=close;await Promise.resolve();}';
    expect(resolve(setup + synchronous + 'set(handlers);handlers[0](row);row.label;')).toEqual(UNRESOLVED);
  });

  it('considers delayed slot replacements once module evaluation can resume them', () => {
    const setup =
      'const row={label:"night"},handlers=[];function close(desk){desk.label="closed";}function read(desk){return desk.label;}handlers[0]=read;async function set(list){const market=await Promise.resolve();list[0]=close;}';
    for (const pause of ['await Promise.resolve();', 'for await(const desk of []){}', '{await using desk=null;}']) {
      expect(resolve(setup + 'set(handlers);' + pause + 'handlers[0](row);row.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + pause + 'set(handlers);handlers[0](row);row.label;')).toEqual({
        ok: true,
        value: 'night',
      });
    }
    expect(resolve(setup + 'await using desk=null;set(handlers);handlers[0](row);row.label;')).toEqual({
      ok: true,
      value: 'night',
    });
  });

  it('uses the first module suspension after an async setter has been called', () => {
    const setup =
      'const row={label:"night"},handlers=[];function close(desk){desk.label="closed";}function read(desk){return desk.label;}handlers[0]=read;async function set(list){const chosen=list;await Promise.resolve();chosen[0]=close;}await Promise.resolve();set(handlers);';
    expect(resolve(setup + 'handlers[0](row);await Promise.resolve();row.label;')).toEqual({
      ok: true,
      value: 'night',
    });
    expect(resolve(setup + 'await Promise.resolve();handlers[0](row);row.label;')).toEqual(UNRESOLVED);
  });

  it('applies array methods to the argument and values from the same helper invocation', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},books=[day],other=[night];function close(row){row.label="closed";}';
    for (const prepare of [
      'function add(list,row){list.unshift(row);}add(other,day);add(books,night);',
      'function add(list,offset,row){list.splice(offset,0,row);}add(books,0,night);',
      'function set(list,row){const chosen=list;chosen.fill(row);}set(books,night);',
      'books.push(night);function move(list){list.copyWithin(0,1);}move(books);',
      'books.push(night);function move(list){list.reverse();}move(books);',
      'function replace(list,row){list.unshift(day);list[0]=row;}replace(books,night);',
    ]) {
      expect(resolve(setup + prepare + 'close(books[0]);night.label;'), prepare).toEqual(UNRESOLVED);
      expect(resolve(setup + prepare + 'close(books[0]);day.label;'), prepare).toEqual({ ok: true, value: 'day' });
    }
    const early = 'const before=books[0];function add(list){list.unshift(night);}add(books);close(before);';
    expect(resolve(setup + early + 'night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('follows an array edit through the invocation that created a returned function', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},rows=[day],other=[night];function close(row){row.label="closed";}';
    for (const create of [
      'function later(list,row){return ()=>list.unshift(row);}const unused=later(other,day);later(rows,night)();',
      'function later(list){return row=>list.unshift(row);}later(rows)(night);',
      'function later(row){return list=>list.unshift(row);}later(night)(rows);',
      'function later(row){return ()=>this.unshift(row);}later.call(rows,night)();',
      'function later(list,row){return {move(){list[0]=row;}};}later(rows,night).move();',
      'function later(list,row){return ()=>()=>list.unshift(row);}later(rows,night)()();',
    ])
      expect(resolve(setup + create + 'close(rows[0]);night.label;'), create).toEqual(UNRESOLVED);
    const deferred =
      'function later(list,row){return ()=>list.unshift(row);}const unused=later(rows,night);later(other,day)();close(rows[0]);';
    expect(resolve(setup + deferred + 'night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('keeps untouched rows exact when a returned setter is the only possible callee', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},rows=[day];function close(row){row.label="closed";}function factory(list){return row=>list.unshift(row);}';
    for (const route of ['factory(rows)(night);', 'const change=factory(rows);change(night);']) {
      expect(resolve(setup + route + 'close(rows[0]);day.label;'), route).toEqual({ ok: true, value: 'day' });
      expect(resolve(setup + route + 'close(rows[0]);night.label;'), route).toEqual(UNRESOLVED);
    }
    const ambiguous = 'const make=marketOpen?factory:exchangeFactory;make(rows)(night);close(rows[0]);';
    expect(resolve(setup + ambiguous + 'day.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + ambiguous + 'night.label;')).toEqual(UNRESOLVED);
  });

  it('carries the array and row through each forwarding helper in execution order', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},rows=[day],other=[night];function close(row){row.label="closed";}function put(list,row){list[0]=row;}function add(list,row){list.unshift(row);}';
    for (const route of [
      'function move(list,row){put(list,row);}move(rows,night);',
      'function second(list,row){add(list,row);}function first(list,row){second(list,row);}first(other,day);first(rows,night);',
      'function move(fn,list,row){fn(list,row);}move(add,rows,night);',
      'function move(list,row){list[0]=day;put(list,row);}move(rows,night);',
      'function later(list){return row=>put(list,row);}later(rows)(night);',
    ]) {
      expect(resolve(setup + route + 'close(rows[0]);night.label;'), route).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'close(rows[0]);day.label;'), route).toEqual({ ok: true, value: 'day' });
    }
    const restore = 'function move(list,row){put(list,row);list[0]=day;}move(rows,night);close(rows[0]);';
    expect(resolve(setup + restore + 'night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('includes slots moved more than once through identical forwarding calls', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},rows=[day];function add(list,row){list.unshift(row);}function twice(list,row){add(list,row);add(list,row);}function close(row){row.label="closed";}';
    expect(resolve(setup + 'twice(rows,night);close(rows[1]);night.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + 'twice([day],night);close(rows[0]);night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('reads a helper argument at its place between nested array edits', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},rows=[day];function close(row){row.label="closed";}function put(list,row){list[0]=row;}function use(list){close(list[0]);}';
    for (const route of [
      'put(list,row);close(list[0]);',
      'put(list,row);close(list[0]);put(list,day);',
      'put(list,row);const chosen=list[0];put(list,day);close(chosen);',
      'put(list,row);use(list);',
      'put(list,row);const edit=close.bind(null,list[0]);put(list,day);edit();',
    ]) {
      const source = setup + 'function route(list,row){' + route + '}route(rows,night);';
      expect(resolve(source + 'night.label;'), route).toEqual(UNRESOLVED);
      expect(resolve(source + 'day.label;'), route).toEqual({ ok: true, value: 'day' });
    }
    const before =
      setup + 'function route(list,row){const chosen=list[0];put(list,row);close(chosen);}route(rows,night);';
    expect(resolve(before + 'night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('finishes reading inside a helper before assigning its return value to an array', () => {
    const setup = 'const day={label:"day"},night={label:"night"},rows=[day];function close(row){row.label="closed";}';
    const inside = 'function choose(list){list[0]=night;close(rows[0]);return night;}rows[0]=choose([day]);';
    expect(resolve(setup + inside + 'day.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + inside + 'night.label;')).toEqual({ ok: true, value: 'night' });
    const after = 'function choose(list){list[0]=night;return day;}rows[0]=choose(rows);close(rows[0]);';
    expect(resolve(setup + after + 'day.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + after + 'night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('calls the object method installed by a helper during collection', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    const setter = 'function set(book,fn){book.update=fn;}';
    for (const route of [
      'const book={update:read};set(book,close);book.update(night);',
      'const book={};function forward(book,fn){set(book,fn);}forward(book,close);book.update(night);',
      'const book={update:read};function install(fn){this.update=fn;}install.call(book,close);book.update(night);',
      'const book={update:read};set(book,close);book.update(night);set(book,read);book.update(day);',
    ]) {
      expect(resolve(setup + setter + route + 'night.label;'), route).toEqual(UNRESOLVED);
      expect(resolve(setup + setter + route + 'day.label;'), route).toEqual({ ok: true, value: 'day' });
    }
    const restore = 'const book={update:close};set(book,read);book.update(night);';
    expect(resolve(setup + setter + restore + 'night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('pairs a callback read from a supplied container with the row from the same call', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    for (const route of [
      'function run(list,row){list[0](row);}run([read],day);run([close],night);',
      'function run(book,row){book.update(row);}run({update:read},day);run({update:close},night);',
      'function run(list,row){list[0](row);}function route(list,row){run(list,row);}route([close],night);',
      'function make(book){return row=>book.update(row);}make({update:close})(night);',
      'function run(row){this.update(row);}run.call({update:close},night);',
      'const handlers=[read];function run(list,row){list[0](row);}run(handlers,day);handlers[0]=close;run(handlers,night);',
      'function run(list,row){list[0]=close;list[0](row);}run([read],night);',
    ]) {
      expect(resolve(setup + route + 'night.label;'), route).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;'), route).toEqual({ ok: true, value: 'day' });
    }
    const restore = 'function run(list,row){list[0]=read;list[0](row);}run([close],night);';
    expect(resolve(setup + restore + 'night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('applies array edits made by the callback selected inside a helper', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},rows=[day];function close(row){row.label="closed";}function read(){}function set(list,row){list[0]=row;}';
    for (const route of [
      'function run(h,list,row){h[0]=set;h[0](list,row);}run([read],rows,night);',
      'function run(h,list,row){h.unshift(set);h[0](list,row);}run([read],rows,night);',
      'function run(h,list,row){h.update=set;h.update(list,row);}run({update:read},rows,night);',
      'function use(h,list,row){h[0](list,row);}function run(h,list,row){h.unshift(set);use(h,list,row);}run([read],rows,night);',
      'function run(h,list,row){h[0]=set;const change=h[0];h[0]=read;change(list,row);}run([read],rows,night);',
      'function run(h,list,row){const change=h[0].bind(null,list,row);h[0]=read;change();}run([set],rows,night);',
    ]) {
      expect(resolve(setup + route + 'close(rows[0]);night.label;'), route).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'close(rows[0]);day.label;'), route).toEqual({ ok: true, value: 'day' });
    }
    const restore = 'function run(h,list,row){h[0]=read;h[0](list,row);}run([set],rows,night);';
    expect(resolve(setup + restore + 'close(rows[0]);night.label;')).toEqual({ ok: true, value: 'night' });
  });

  it('re-reads a forwarded callback when another write separates two calls', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},rows=[day];function close(row){row.label="closed";}function read(){}function put(list,row){list[0]=row;}function use(h,list,row){h[0](list,row);}';
    for (const route of [
      'function run(h,list,row){use(h,list,row);h[0]=put;use(h,list,row);}run([read],rows,night);',
      'function install(h){h.unshift(put);}function run(h,list,row){use(h,list,row);install(h);use(h,list,row);}run([read],rows,night);',
    ]) {
      expect(resolve(setup + route + 'close(rows[0]);night.label;'), route).toEqual(UNRESOLVED);
    }
  });

  it('calls the replacement on the second invocation of a self-replacing callback', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},rows=[day];function close(row){row.label="closed";}function write(h,list,row){list[0]=row;}function use(h,list,row){h[0](h,list,row);}';
    for (const arm of ['h[0]=write;', 'h.unshift(write);', 'h.shift();']) {
      const run =
        'function arm(h){' +
        arm +
        '}function run(h,list,row){use(h,list,row);use(h,list,row);}run([arm,write],rows,night);';
      expect(resolve(setup + run + 'close(rows[0]);night.label;'), arm).toEqual(UNRESOLVED);
    }
    const once = 'function arm(h){h[0]=write;}use([arm],rows,night);';
    expect(resolve(setup + once + 'close(rows[0]);night.label;')).toEqual({ ok: true, value: 'night' });
    const computed =
      'function arm(h){h.update=write;}function step(h,list,row,key){h[key](h,list,row);}function run(h,list,row){step(h,list,row,"update");step(h,list,row,"update");}run({update:arm},rows,night);';
    expect(resolve(setup + computed + 'close(rows[0]);night.label;')).toEqual(UNRESOLVED);
  });

  it('reads a returned array element at the invocation that supplied the changed object', () => {
    const setup =
      'const day={label:"day"},night={label:"night"},rows=[day];function close(row){row.label="closed";}function select(){return rows[0];}function forward(){return select();}';
    for (const read of ['select()', 'forward()']) {
      const sequence = setup + 'const first=' + read + ';rows.unshift(night);const last=' + read + ';';
      expect(resolve(sequence + 'close(last);day.label;')).toEqual({ ok: true, value: 'day' });
      expect(resolve(sequence + 'close(last);night.label;')).toEqual(UNRESOLVED);
      expect(resolve(sequence + 'close(first);night.label;')).toEqual({ ok: true, value: 'night' });
      expect(resolve(sequence + 'close(first);day.label;')).toEqual(UNRESOLVED);
    }
  });

  it('tracks the arguments captured by the bound function that actually runs', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closing";}';
    for (const route of [
      'const unused=close.bind(null,day);const edit=close.bind(null,night);edit();',
      'let row=night;const edit=close.bind(null,row);row=day;edit();',
      'function write(first,...rows){rows[0].label="closing";}const edit=write.bind(null,day);edit(night);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('retains the first bound receiver when a caller supplies a different one', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(){this.label="closing";}';
    const route = 'let desk=night;const edit=close.bind(desk);desk=day;edit.call(desk);';
    expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
  });

  it('uses the function selected immediately before binding within the same statement', () => {
    const setup =
      'const desk={label:"opening"};function close(row){row.label="closed";}function read(row){return row.label;}';
    for (const capture of [
      'const change=(fn=OP,fn.bind(null,desk));',
      'const next=(fn=OP),change=fn.bind(null,desk);',
    ]) {
      expect(resolve(setup + 'let fn=close;' + capture.replace('OP', 'read') + 'change();desk.label;')).toEqual({
        ok: true,
        value: 'opening',
      });
      expect(resolve(setup + 'let fn=read;' + capture.replace('OP', 'close') + 'change();desk.label;')).toEqual(
        UNRESOLVED,
      );
    }
  });

  it('waits for invocation before following a callback supplied as a bound argument', () => {
    const setup =
      'const desk={label:"opening"};function close(row){row.label="closed";}function mark(){close(desk);}function use(fn){fn();}';
    expect(resolve(setup + 'const unused=use.bind(null,mark);desk.label;')).toEqual({ ok: true, value: 'opening' });
    expect(resolve(setup + 'const edit=use.bind(null,mark);edit();desk.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + 'let keep=use;const unused=keep.bind(null,mark);desk.label;')).toEqual({
      ok: true,
      value: 'opening',
    });
  });

  it('checks a bound callback default in the scope that supplied its argument', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    const route =
      'function work(fn=()=>close(day)){fn(night);}function invoke(effect){effect();}function choose(fn){invoke(work.bind(null,fn));}choose(read);choose(close);';
    expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
  });

  it('keeps the bound receiver outside a rest parameter with an unknown index', () => {
    const setup =
      'const receiver={label:"receiver"},open={label:"opening"},late={label:"evening"};function close(...rows){rows[slot].label="closing";}';
    const route = 'const slot=1;close.bind(receiver,open)(late);';
    expect(resolve(setup + route + 'receiver.label;')).toEqual({ ok: true, value: 'receiver' });
    expect(resolve(setup + route + 'late.label;')).toEqual(UNRESOLVED);
  });

  it('follows recursively forwarded bound functions and keeps overridden bind methods separate', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    const routes = [
      'function route(fn,n){if(n)route(fn.bind(null,night),n-1);else fn();}route(close,2);',
      'function route(fn,n){if(n)route(close.bind(null,night),n-1);else fn();}route(read.bind(null,day),2);',
      'close.bind=()=>()=>{};close.bind(null,day)();delete close.bind;close.bind(null,night)();',
      'const edit=close.bind(null,night);close.call=()=>{};edit.call(null);',
      'const edit=close.bind();edit.apply(null,[night]);',
    ];
    for (const route of routes) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('tracks rest arguments combined from bound spreads and an applied list', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(...rows){rows[1].label="closed";}';
    for (const route of [
      'const list=[night];close.bind(null,day).apply(null,list);',
      'const prefix=[day];close.bind(null,...prefix)(night);',
      'const prefix=[null,day];close.bind(...prefix)(night);',
      'close.bind(null,day,night).apply();',
    ])
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
  });

  it('retains arguments appended on repeated visits to a recursive binding site', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function extend(fn,n,row){if(n)extend(fn.bind(null,row),n-1,night);else fn();}';
    for (const route of [
      'function close(first,second){second.label="closed";}extend(close,2,day);',
      'function close(first,second,third){third.label="closed";}extend(close,3,day);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
    expect(
      resolve(
        'const desk={label:"opening"};function close(row){row.label="closed";}function run(){close.bind(null,desk)();}[0].forEach(run);desk.label;',
      ),
    ).toEqual(UNRESOLVED);
  });

  it('pairs a returned function with the factory call whose captured object it changes', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    for (const factory of [
      'function make(row){return ()=>close(row);}',
      'function make(row){return ()=>{row.label="closed";};}',
      'function make(row){const run=()=>close(row);return run;}',
    ]) {
      const route = factory + 'const unused=make(day);const edit=make(night);edit();';
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('keeps direct writes inside unused and deferred returned functions out of collection', () => {
    const setup = 'const desk={label:"opening"};function make(row){return ()=>{row.label="closed";};}';
    for (const use of ['make(desk);', 'const edit=make(desk);test("places an order",edit);'])
      expect(resolve(setup + use + 'desk.label;')).toEqual({ ok: true, value: 'opening' });
  });

  it('follows a returned callback argument and callbacks captured by a custom bind method', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function write(row){row.label="closed";}function read(row){return row.label;}';
    for (const route of [
      'function select(fn){return fn;}select(read)(day);select(write)(night);',
      'read.bind=(receiver,row)=>()=>write(row);const unused=read.bind(null,day);read.bind(null,night)();',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('preserves the factory binding when a returned closure calls or forwards a sibling helper', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function write(row){row.label="closed";}function invoke(fn){fn();}';
    for (const body of [
      'function dispatch(){write(row);}return ()=>dispatch();',
      'function dispatch(){row.label="closed";}return ()=>dispatch();',
      'const dispatch=()=>write(row);return ()=>invoke(dispatch);',
      'function next(){return ()=>write(row);}return next;',
    ]) {
      const route =
        'function make(row){' +
        body +
        '}' +
        (body.endsWith('return next;') ? 'make(day)(); make(night)()();' : 'make(day); make(night)();');
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('uses a callback default when a factory can return without a value', () => {
    const setup =
      'const desk={label:"opening"};function read(row){return row.label;}function close(row){row.label="closed";}function apply(fn=close){fn(desk);}';
    for (const route of [
      'function pick(flag){if(flag)return;return read;}apply(pick(true));',
      'function pick(flag){if(flag)return read;}apply(pick(false));',
    ])
      expect(resolve(setup + route + 'desk.label;')).toEqual(UNRESOLVED);
    expect(
      resolve(setup + 'function pick(flag){if(flag)return read;return read;}apply(pick(true));desk.label;'),
    ).toEqual({ ok: true, value: 'opening' });
  });

  it('keeps a closure factory default out of a call supplied with a defined constant', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function make(row=day){return ()=>{row.label="closed";};}';
    const route = 'const early=make();make(night)();';
    expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
  });

  it('selects a returned callback using a literal factory argument unless its parameter is reassigned', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function write(row){row.label="closed";}function read(row){return row.label;}';
    const route =
      'function make(flag,row){return flag?()=>write(row):()=>read(row);}make(false,day)();make(true,night)();';
    expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
    expect(
      resolve(
        setup +
          'function make(flag,row){flag=true;return flag?()=>write(row):()=>read(row);}make(false,day)();day.label;',
      ),
    ).toEqual(UNRESOLVED);
  });

  it('keeps direct writes in unused conditional return branches out of collection', () => {
    const setup = 'const desk={label:"opening"};';
    for (const route of [
      'function make(flag,row){return flag?()=>{row.label="closed";}:()=>{};}make(true,desk);',
      'function make(row){const edit=()=>{row.label="closed";};return true&&edit;}make(desk);',
    ])
      expect(resolve(setup + route + 'desk.label;')).toEqual({ ok: true, value: 'opening' });
  });

  it('follows returned callbacks also invoked from an object, an array, or a getter during the factory call', () => {
    const setup = 'const desk={label:"opening"};';
    for (const invocation of [
      'const ops={edit};ops.edit();',
      '[edit][0]();',
      'const obj={get run(){edit();return 1;}};void obj.run;',
    ])
      expect(
        resolve(
          setup +
            'function make(row){function edit(){row.label="closed";}' +
            invocation +
            'return edit;}make(desk);desk.label;',
        ),
      ).toEqual(UNRESOLVED);
    expect(
      resolve(
        setup +
          'function make(row){function edit(){row.label="closed";}const ops={edit};return edit;}make(desk);desk.label;',
      ),
    ).toEqual({ ok: true, value: 'opening' });
  });

  it('pairs methods selected from a freshly returned object or array with the right factory', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function write(row){row.label="closed";}';
    for (const [returned, invoked] of [
      ['{apply(){write(row);}}', '.apply()'],
      ['{edit:()=>write(row)}', '["edit"]()'],
      ['[()=>write(row)]', '[0]()'],
    ]) {
      const route = 'function make(row){return ' + returned + ';}make(day);make(night)' + invoked + ';';
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('keeps a captured bind argument paired with its factory through local aliases', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    for (const arg of [
      'const local=row;return close.bind(null,local);',
      'const local={desk:row};return close.bind(null,local.desk);',
    ]) {
      const route = 'function make(row){' + arg + '}make(day);make(night)();';
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
    }
  });

  it('keeps an unused factory default readable through aliases of a defined call argument', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function make(row=day){return ()=>{row.label="closed";};}';
    const route = 'const selected=night,alias=selected;make(alias)();';
    expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
  });

  it('follows methods selected by constant destructuring from a factory result', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    for (const [returned, pattern] of [
      ['{edit:()=>close(row)}', '{edit:run}'],
      ['[()=>close(row)]', '[run]'],
      ['{ops:[()=>close(row)]}', '{ops:[run]}'],
    ]) {
      const route = 'function make(row){return ' + returned + ';}make(day);const ' + pattern + '=make(night);run();';
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('follows paired getter and setter bodies when the module reads or assigns the property', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    for (const route of [
      'const ops={get edit(){close(night);return read;},set edit(fn){}};void ops.edit;',
      'const ops={set edit(row){close(row);},get edit(){return read;}};ops.edit=night;',
      'const ops={get edit(){close(night);return read;},set edit(fn){}};ops.edit=read;void ops.edit;',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('uses a getter’s returned callback before deciding whether a parameter default runs', () => {
    const setup =
      'const desk={label:"opening"};function read(row){return row.label;}function close(row){row.label="closed";}function route(fn=close){fn(desk);}';
    expect(resolve(setup + 'const ops={get edit(){return read;}};route(ops.edit);desk.label;')).toEqual({
      ok: true,
      value: 'opening',
    });
    expect(resolve(setup + 'const ops={get edit(){return;}};route(ops.edit);desk.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + 'const ops={set edit(fn){}};route(ops.edit);desk.label;')).toEqual(UNRESOLVED);
  });

  it('uses the active object method after replacement, deletion and literal spreads', () => {
    const setup =
      'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}function read(row){return row.label;}';
    for (const route of [
      'const ops={edit:read};ops.edit=close;ops.edit(night);delete ops.edit;ops.edit=read;ops.edit(day);',
      'const ops={edit:read,...{edit:close}};ops.edit(night);',
      'const ops={edit:close,...{quote:read}};ops.edit(night);',
      'const extra=externalMethods();const ops={edit:close,...extra};ops.edit(night);',
      'const ops={edit:read};ops[selectSlot()]=close;ops.edit(night);',
      'const ops={edit:read};if(trading)ops.edit=close;ops.edit(night);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('selects the final accessor across interleaved methods, data and spreads', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    for (const route of [
      'const ops={set edit(v){close(v);},other:1,get edit(){},get edit(){}};ops.edit=night;',
      'const ops={get edit(){close(day);},edit:1,get edit(){close(night);}};void ops.edit;',
      'const ops={get edit(){close(day);},...{edit:1},get edit(){close(night);}};void ops.edit;',
      'const key="edit";const ops={get [key](){close(night);}};void ops[key];',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('retains or discards a returned write through sequence, assignment and repeated aliases', () => {
    const setup = 'const desk={label:"opening"};function make(row){const edit=()=>{row.label="closed";};let selected;';
    for (const result of ['(row,edit)', 'selected=edit', 'edit||edit']) {
      const code = setup + 'return ' + result + ';}';
      expect(resolve(code + 'make(desk);desk.label;')).toEqual({ ok: true, value: 'opening' });
      expect(resolve(code + 'make(desk)();desk.label;')).toEqual(UNRESOLVED);
    }
  });

  it('tracks conditional helper returns with omitted, spread or defaulted arguments', () => {
    const setup =
      'const desk={label:"opening"};function close(){desk.label="closed";}function read(){return desk.label;}';
    for (const route of [
      'function make(flag=true){return flag?close:read;}make()();',
      'function make(flag){return flag?close:read;}make(...[true])();',
      'function make(prefix,flag){return flag?close:read;}make(...[0],true)();',
      'function make(flag){return flag?read:close;}make()();',
    ])
      expect(resolve(setup + route + 'desk.label;')).toEqual(UNRESOLVED);
  });

  it('forwards a bound callback from outside the factory and honors a possible custom bind', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    for (const route of [
      'const bound=close.bind(null,night);function get(){return bound;}get()();',
      'if(special)close.bind=()=>()=>{};const edit=close.bind(null,night);edit();',
      'function get(){if(false)return external();return close;}get()(night);',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('honors defaults on destructured callbacks and copies only the remaining object fields', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    for (const route of [
      'const {edit=()=>close(night)}={};edit();',
      'const {edit=()=>close(day)}={edit:()=>close(night)};edit();',
      'function make(row){return {edit:()=>close(row)};}const {edit=()=>close(day)}=make(night);edit();',
      'const {edit,...remaining}={edit:()=>close(night)};remaining.edit?.();edit();',
    ]) {
      expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    }
  });

  it('retains the captured row when the same returned callback is forwarded twice', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    const route =
      'function both(first,second){first();second();}function make(row){return ()=>close(row);}const same=make(night);both(same,same);';
    expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
  });

  it('retains outer bindings when a returned callback creates a second local factory', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    const route =
      'function make(row){return ()=>{function next(){return ()=>close(row);}return next();};}make(day)();make(night)()();';
    expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
  });

  it('resolves a recursively selected callback through a forwarding helper', () => {
    const setup = 'const day={label:"day"},night={label:"night"};function close(row){row.label="closed";}';
    const route =
      'function forward(fn){return fn;}function make(n){const fn=n?make(n-1):close;return forward(fn);}make(2)(night);';
    expect(resolve(setup + route + 'day.label;')).toEqual({ ok: true, value: 'day' });
    expect(resolve(setup + route + 'night.label;')).toEqual(UNRESOLVED);
  });

  it('flags titles changed through helper arguments resolved in the calling scope', () => {
    const setup = 'const opening={desk:{label:"opening"}}; const evening={desk:{label:"evening"}};';
    for (const route of [
      'function close(desk){desk.label="closing";} close(evening.desk);',
      'function close({desk}){desk.label="closing";} {const opening=evening;close(opening);}',
      'const close=desk=>{desk.label="closing";}; function route(desk){close(desk);} route(evening.desk);',
      '((desk)=>{desk.label="closing";})(evening.desk);',
    ]) {
      expect(resolve(setup + route + 'evening.desk.label;')).toEqual(UNRESOLVED);
      expect(resolve(setup + route + 'opening.desk.label;')).toEqual({ ok: true, value: 'opening' });
    }
    const deferred = 'function close(desk){desk.label="closing";} test("settles late",()=>close(evening.desk));';
    expect(resolve(setup + deferred + 'evening.desk.label;')).toEqual({ ok: true, value: 'evening' });
  });

  it('uses the call time when a helper forwards an outer alias to another helper', () => {
    const setup = 'const opening={label:"opening"}; const evening={label:"evening"}; let desk=opening;';
    const functions = 'function close(entry){entry.label="closing";} function route(){close(desk);}';
    const before = setup + functions + 'route(); desk=evening;';
    const after = setup + functions + 'desk=evening; route();';
    expect(resolve(before + 'evening.label;')).toEqual({ ok: true, value: 'evening' });
    expect(resolve(before + 'opening.label;')).toEqual(UNRESOLVED);
    expect(resolve(after + 'opening.label;')).toEqual({ ok: true, value: 'opening' });
    expect(resolve(after + 'evening.label;')).toEqual(UNRESOLVED);
    const twice = setup + functions + 'route(); desk=evening; route();';
    expect(resolve(twice + 'opening.label;')).toEqual(UNRESOLVED);
    expect(resolve(twice + 'evening.label;')).toEqual(UNRESOLVED);
  });

  it('follows a helper return to the object supplied on that particular call', () => {
    const setup = 'const opening={label:"opening"}; const evening={label:"evening"};';
    const route =
      'function select(desk){const chosen=desk;return chosen;} select(opening); select(evening).label="closing";';
    expect(resolve(setup + route + 'evening.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + route + 'opening.label;')).toEqual({ ok: true, value: 'opening' });
  });

  it('keeps unrelated titles readable when a write uses the return of an ambient helper', () => {
    const code = 'declare function externalDesk(): {label:string}; const opening={label:"opening"};';
    expect(resolve(code + 'externalDesk().label="closing"; opening.label;')).toEqual({ ok: true, value: 'opening' });
  });

  it('uses the default reference only when the supplied argument could be undefined', () => {
    const setup = 'const opening={desk:{label:"opening"}}; const evening={desk:{label:"evening"}};';
    const helper = 'function close(desk=opening.desk){desk.label="closing";}';
    expect(resolve(setup + helper + 'close(evening.desk); opening.desk.label;')).toEqual({
      ok: true,
      value: 'opening',
    });
    expect(resolve(setup + helper + 'close(); opening.desk.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + helper + 'delete evening.desk;close(evening.desk); opening.desk.label;')).toEqual(
      UNRESOLVED,
    );
  });

  it('keeps a default object independent when a caller supplies a known array element', () => {
    const code = 'const opening={label:"opening"};const desks=[,{label:"evening"}];const flags=[true];';
    const close = 'function close(desk=opening){desk.label="closing";}';
    expect(resolve(code + close + 'close(desks[1]); opening.label;')).toEqual({ ok: true, value: 'opening' });
    expect(resolve(code + close + 'close(desks[0]); opening.label;')).toEqual(UNRESOLVED);
  });

  it('preserves possible defaults for missing members, opaque arguments and spread data', () => {
    const setup = 'const opening={label:"opening"};function close(desk=opening){if(desk)desk.label="closing";}';
    for (const call of [
      'const book={};close(book.desk);',
      'const book={desk:0};close(book.desk.label);',
      'const book={desk:{}};close(book[key()]);',
      'const book={__proto__:null};close(book.__proto__);',
      'const desks=[...readDesks()];close(desks[0]);',
      'close(findDesk());',
      'function route(){close(findDesk());} route();',
    ])
      expect(resolve(setup + call + ' opening.label;')).toEqual(UNRESOLVED);
  });

  it('follows changes to shared rest arguments and preserves independent argument objects', () => {
    const setup = 'const day={label:"day"}; const night={label:"night"};';
    const change = 'function close(...desks){desks[1].label="closing";} close(day,night);';
    expect(resolve(setup + change + 'day.label;')).toEqual({ ok: true, value: 'day' });
    expect(resolve(setup + change + 'night.label;')).toEqual(UNRESOLVED);
    expect(resolve(setup + 'function reverse(...desks){desks.reverse();} reverse(day,night); day.label;')).toEqual({
      ok: true,
      value: 'day',
    });
  });

  it('distinguishes writing to a promise or iterator from writing to the object its function returns', () => {
    for (const declaration of ['async function select(desk){return desk;}', 'function* select(desk){return desk;}']) {
      expect(
        resolve('const book={label:"opening"};' + declaration + 'select(book).label="closing"; book.label;'),
      ).toEqual({ ok: true, value: 'opening' });
    }
  });

  it('tracks distinct nested calls that return through the same parameter declaration', () => {
    const code =
      'const opening={label:"opening"}; const evening={label:"evening"}; function select(desk){return desk;}';
    const write = 'select(opening); select(select(evening)).label="closing";';
    expect(resolve(code + write + 'evening.label;')).toEqual(UNRESOLVED);
    expect(resolve(code + write + 'opening.label;')).toEqual({ ok: true, value: 'opening' });
  });

  it('tracks a possible returned object when another branch returns without a value', () => {
    const code = 'const book={label:"opening"}; function choose(desk,flag){if(flag)return desk;return;}';
    expect(
      resolve(code + 'const selection=choose(book,true); if(selection)selection.label="closing"; book.label;'),
    ).toEqual(UNRESOLVED);
  });

  it('terminates on recursive calls while following the object returned by the base case', () => {
    const code =
      'const book={label:"opening"}; function select(desk,depth){if(depth===0)return desk;return select(desk,depth-1);}';
    expect(resolve(code + 'select(book,2).label="closing";book.label;')).toEqual(UNRESOLVED);
  });

  it('tracks objects selected by an expression and preserves titles when their branch cannot supply the alias', () => {
    const prefix = 'const book={desk:{label:"opening auction"}};';
    for (const expression of [
      '(0,book.desk)',
      'true ? book.desk : {}',
      'book.desk || {}',
      'book.desk ?? {}',
      'choose() && book.desk',
      'choose() ? {} : book.desk',
      'void 0 ?? book.desk',
      'null ?? book.desk',
      '/close/ && book.desk',
    ]) {
      expect(resolve(prefix + `const desk=${expression}; desk.label="closing auction"; book.desk.label;`)).toEqual(
        UNRESOLVED,
      );
    }
    for (const expression of [
      '(book.desk,{})',
      'false ? book.desk : {}',
      '{} || book.desk',
      'false && book.desk',
      '{} ?? book.desk',
      '0n ?? book.desk',
    ]) {
      expect(
        resolve(prefix + `const desk=${expression}; if (desk) desk.label="closing auction"; book.desk.label;`),
      ).toEqual({ ok: true, value: 'opening auction' });
    }
  });

  it('tracks a destructuring default when a literal omits its value and preserves independent literal values', () => {
    const prefix = 'const book={desk:{label:"opening auction"}};';
    const read = ' desk.label="closing auction"; book.desk.label;';
    expect(resolve(prefix + 'const {desk=book.desk}={};' + read)).toEqual(UNRESOLVED);
    expect(resolve(prefix + 'const [desk=book.desk]=[];' + read)).toEqual(UNRESOLVED);
    expect(resolve(prefix + 'const {desk=book.desk}={desk:{}};' + read)).toEqual({
      ok: true,
      value: 'opening auction',
    });
    expect(resolve(prefix + 'const {desk=book.desk}={desk:void 0};' + read)).toEqual(UNRESOLVED);
  });

  it('invalidates only shared children when writes go through literal wrappers or shallow copies', () => {
    const prefix = 'const book = {desk: {label: "opening auction"}};';
    for (const change of [
      'const copy = {...book}; copy.desk.label = "closing auction";',
      'const {...copy} = book; Object.assign(copy.desk, {label:"closing auction"});',
      'const wrapped = [book.desk]; wrapped[0].label = "closing auction";',
      'const desks = [{}, book.desk]; const [, ...copy] = desks; copy[0].label = "closing auction";',
      'const wrapped = {current:book.desk}; delete wrapped.current.label;',
    ])
      expect(resolve(prefix + change + 'book.desk.label;')).toEqual(UNRESOLVED);
    for (const change of [
      'const wrapped = {current:book.desk}; wrapped.current = {};',
      'const copy = {...book, desk:{}}; copy.desk.label = "closing auction";',
      'const copy = {current:book.desk, other:{}}; copy.other.label = "closing auction";',
    ])
      expect(resolve(prefix + change + 'book.desk.label;')).toEqual({ ok: true, value: 'opening auction' });
  });

  it('tracks aliases across object and array spreads that can supply a destructured value', () => {
    const prefix = 'const desk={label:"opening auction"}; const book={window:desk};';
    for (const setup of [
      'const {window}= { ...book };',
      'const {window}= { window:desk, other:42 };',
      'const {window}= { [column()]:desk };',
      'const [{label}, window] = [desk, ...[], desk];',
      'const [, window=desk] = [0, ...[], , ];',
      'const [window, ...later] = [...[], desk];',
    ])
      expect(resolve(prefix + setup + 'window.label="closing auction"; desk.label;')).toEqual(UNRESOLVED);
    expect(
      resolve(prefix + 'const {window}= { ...book, window:{} }; window.label="closing auction"; desk.label;'),
    ).toEqual({ ok: true, value: 'opening auction' });
    expect(
      resolve(prefix + 'const [window, ...other]=[{}, ...[desk]]; window.label="closing auction"; desk.label;'),
    ).toEqual({ ok: true, value: 'opening auction' });
  });

  it('follows possible array elements for a runtime index and preserves unrelated tail entries', () => {
    const prefix = 'const desk={label:"opening auction"}; const desks=[desk];';
    expect(
      resolve(
        prefix + 'const list=[...desks]; const chosen=list[chooseIndex()]; chosen.label="closing auction"; desk.label;',
      ),
    ).toEqual(UNRESOLVED);
    expect(
      resolve(
        prefix + 'const list=[...[], {}, desk]; const chosen=list[0]; chosen.label="closing auction"; desk.label;',
      ),
    ).toEqual({ ok: true, value: 'opening auction' });
  });

  it('keeps a helper parameter unresolved when a nested member changes in its body', () => {
    const inv = scanVitest(`${VITEST_IMPORT}
function currentWindow() { return { label: 'opening auction' }; }
function register(desk) {
  desk.pricing.limits.max++;
  delete currentWindow().label;
  test(desk.label, () => {});
}
register({label:"closing auction", pricing:{limits:{max:4}}});`);
    expect(inv.tests.map((test) => test.hasDynamicTitle)).toEqual([true]);
  });

  it('binds destructured parameters, with holes, rests and defaults, as JavaScript does', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { ORDER } from './orders';
const KEY = 'venue';
function orderTests([side, qty], { [KEY]: venue, ...rest }, [, first, ...others], { tier = 'retail' } = {}) {
  test(\`\${side} \${qty} on \${venue} for \${rest.account}, \${first} then \${others.join('+')}, \${tier}\`, async () => {});
}
function quoteTests([symbol, ...more], { venue, ...rest }, { [lookupKey()]: desk }) {
  test(\`quotes \${symbol} \${more} on \${venue} \${rest} \${desk}\`, async () => {});
}
function legTests([leg]) {
  test(\`fills \${leg}\`, async () => {});
}
orderTests(['buy', 100], { venue: 'NYSE', account: 'margin' }, ['skip', 'AAPL', 'MSFT', 'NVDA']);
quoteTests(ORDER, 'not an object', { desk: 'fx' });
quoteTests(['AAPL'], ORDER, ORDER);
legTests(...LEGS);
legTests('AAPL');
`);
    expect(inventory.tests.map((test) => test.title)).toEqual([
      'buy 100 on NYSE for margin, AAPL then MSFT+NVDA, retail',
      '`quotes ${symbol} ${more} on ${venue} ${rest} ${desk}`',
      '`quotes ${symbol} ${more} on ${venue} ${rest} ${desk}`',
      '`fills ${leg}`',
      'fills A',
    ]);
  });

  it('leaves names unknown that the helper assigns by destructuring or as a loop variable', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
function routeTests(side, venue, tier, desk, legs) {
  [side] = ['sell'];
  ({ venue } = { venue: 'NYSE' });
  ({ tier = 'professional' } = {});
  for (desk of ['fx']) {}
  [...legs] = [];
  test(\`routes \${side} \${venue} \${tier} \${desk} \${legs}\`, async () => {});
}
function bookTests(account, ...rest) {
  ({ ...rest } = {});
  test(\`books \${account} \${rest}\`, async () => {});
}
routeTests('buy', 'NASDAQ', 'retail', 'equities', 2);
bookTests('margin', 1);
`);
    expect(inventory.tests.map((test) => test.title)).toEqual([
      '`routes ${side} ${venue} ${tier} ${desk} ${legs}`',
      '`books ${account} ${rest}`',
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
Object.assign();
loadConfig().market = 'NYSE';
FEES[pickMethod()]();
let session;
session = 'regular';
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
