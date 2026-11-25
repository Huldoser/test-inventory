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
      '`fills ${leg}`',
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
