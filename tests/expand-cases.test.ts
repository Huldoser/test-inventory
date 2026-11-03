import { describe, expect, it } from 'vitest';
import { scanSource, type Inventory } from '../src/index.ts';
import { codes, PLAYWRIGHT_IMPORT, scanPlaywright, scanVitest, VITEST_IMPORT } from './helpers.ts';

const expand = { expandCases: true };
const cases = (inventory: Inventory) => inventory.tests.map((test) => [test.fullName, test.caseIndex, test.caseCount]);

describe('expandCases with Vitest tables', () => {
  it('lists each case of .each and .for with the title Vitest gives it', () => {
    const code = `${VITEST_IMPORT}
const SIDES = [['buy', 100], ['sell', 50]];
test.each(SIDES)('fills a %s order of %i shares (case %#)', (side, quantity) => {});
test.for([{ tier: 'retail', bps: 25 }, { tier: 'professional', bps: 10 }])('charges $tier accounts $bps bps', () => {});
test.each\`
  venue       | fee
  \${'NASDAQ'} | \${0.3}
  \${'NYSE'}   | \${0.25}
\`('routes to $venue at $fee', () => {});
`;
    const inventory = scanVitest(code, expand);
    expect(cases(inventory)).toEqual([
      ['fills a buy order of 100 shares (case 0)', 0, 1],
      ['fills a sell order of 50 shares (case 1)', 1, 1],
      ['charges retail accounts 25 bps', 0, 1],
      ['charges professional accounts 10 bps', 1, 1],
      ['routes to NASDAQ at 0.3', 0, 1],
      ['routes to NYSE at 0.25', 1, 1],
    ]);
    expect(new Set(inventory.tests.map((test) => test.id)).size).toBe(6);
    expect(inventory.tests.every((test) => test.isParameterized)).toBe(true);
    expect(codes(inventory)).toEqual([]);
    // Without the option, each table is one record, as before.
    expect(cases(scanVitest(code))).toEqual([
      ['fills a %s order of %i shares (case %#)', null, 2],
      ['charges $tier accounts $bps bps', null, 2],
      ['routes to $venue at $fee', null, 2],
    ]);
  });

  it('follows the rules of the Vitest version, which quote $name values before Vitest 5 and have no %$ in 3.0', () => {
    const code = `${VITEST_IMPORT}
test.for([{ side: 'buy' }])('places a $side order', () => {});
test.each(['sell'])('places a %s order, case %$', () => {});
`;
    const titles = (frameworkVersion: string) =>
      scanVitest(code, { ...expand, frameworkVersion }).tests.map((test) => test.title);
    expect(titles('5.0.5')).toEqual(['places a buy order', 'places a sell order, case 1']);
    expect(titles('4.1.12')).toEqual(["places a 'buy' order", 'places a sell order, case 1']);
    expect(titles('3.0.9')).toEqual(["places a 'buy' order", 'places a sell order, case %$']);
  });

  it('repeats a describe table for its tests, with the arguments of each case bound in the callback', () => {
    const inventory = scanVitest(
      `${VITEST_IMPORT}
describe.each(['NASDAQ', 'NYSE'])('%s routing', (venue) => {
  test(\`routes a limit order to \${venue}\`, () => {});
  test.each([1, 2])('splits an order into %i legs', () => {});
});
`,
      expand,
    );
    expect(inventory.suites.map((suite) => [suite.title, suite.caseIndex])).toEqual([
      ['NASDAQ routing', 0],
      ['NYSE routing', 1],
    ]);
    expect(cases(inventory)).toEqual([
      ['NASDAQ routing > routes a limit order to NASDAQ', null, 1],
      ['NASDAQ routing > splits an order into 1 legs', 0, 1],
      ['NASDAQ routing > splits an order into 2 legs', 1, 1],
      ['NYSE routing > routes a limit order to NYSE', null, 1],
      ['NYSE routing > splits an order into 1 legs', 0, 1],
      ['NYSE routing > splits an order into 2 legs', 1, 1],
    ]);
  });

  it('keeps a table as one record, and says why, when a case title would show an array or object or is unknown', () => {
    const inventory = scanVitest(
      `${VITEST_IMPORT}
test.each([[{ side: 'buy' }]])('fills %s', () => {});
test.each([[() => 100]])('prices with %s', () => {});
test.each([['buy']])(orderTitle(), () => {});
test.each(loadOrders())('replays %s', () => {});
describe.each([[{ venue: 'NASDAQ' }]])('routes to %o', () => {});
`,
      expand,
    );
    expect(cases(inventory)).toEqual([
      ['fills %s', null, 1],
      ['prices with %s', null, 1],
      ['orderTitle()', null, 1],
      ['replays %s', null, null],
    ]);
    expect(inventory.suites.map((suite) => [suite.title, suite.caseIndex])).toEqual([['routes to %o', null]]);
    expect(inventory.diagnostics.map((item) => [item.code, item.message])).toEqual([
      [
        'cases-not-expanded',
        "The cases of the table are listed as one record, since the title shows an array or object, which the scan doesn't format the way Vitest does.",
      ],
      [
        'cases-not-expanded',
        "The cases of the table are listed as one record, since the scan can't work out every value in it.",
      ],
      [
        'cases-not-expanded',
        "The cases of the table are listed as one record, since the scan can't work out the title.",
      ],
      ['dynamic-title', 'Title orderTitle() could not be worked out; the record uses its source text.'],
      ['unresolved-cases', 'The cases of .each() could not be counted; caseCount is null.'],
      [
        'cases-not-expanded',
        "The cases of the table are listed as one record, since the title shows an array or object, which the scan doesn't format the way Vitest does.",
      ],
    ]);
  });

  it('expands .for cases of null to no items, and leaves a template table with an unknown value as one record', () => {
    const inventory = scanVitest(
      `${VITEST_IMPORT}
test.for([null, 'buy'])('places a %s order', () => {});
test.each\`
  side      | quantity
  \${'buy'} | \${loadQuantity()}
\`('fills $quantity of $side', () => {});
`,
      expand,
    );
    expect(cases(inventory)).toEqual([
      ['places a undefined order', 0, 1],
      ['places a buy order', 1, 1],
      ['fills $quantity of $side', null, 1],
    ]);
    expect(codes(inventory)).toEqual(['cases-not-expanded']);
  });

  it('points the warning at the table call, also for a test without a callback', () => {
    const inventory = scanVitest(
      `${VITEST_IMPORT}
test.each([[{ side: 'buy' }]])('fills %s');
describe.each([[{ venue: 'NASDAQ' }]])('routes to %s', () => {
  test('routes a limit order', () => {});
});
`,
      expand,
    );
    expect(inventory.diagnostics.map((item) => [item.code, item.lineStart, item.columnStart])).toEqual([
      ['cases-not-expanded', 2, 1],
      ['cases-not-expanded', 3, 1],
    ]);
  });

  it('refuses an expandCases that is not a boolean', () => {
    expect(() =>
      scanSource({
        code: '',
        relativeFilePath: 'tests/fees.test.ts',
        framework: 'vitest',
        expandCases: 'yes' as never,
      }),
    ).toThrow(new TypeError('options.expandCases must be true or false.'));
  });
});

describe('expandCases with loops', () => {
  it('lists each pass of a loop over known values, with its loop variable bound', () => {
    const inventory = scanPlaywright(
      `${PLAYWRIGHT_IMPORT}
const FEES = { retail: 25, professional: 10 };
const SYMBOLS = ['AAPL', 'MSFT'];
for (const symbol of SYMBOLS) {
  test(\`shows a live quote for \${symbol}\`, async () => {});
}
Object.entries(FEES).forEach(([tier, bps]) => {
  test(\`charges \${tier} accounts \${bps} bps\`, async () => {});
});
for (const tier in FEES) {
  test.describe(\`\${tier} accounts\`, () => {
    test(\`opens a \${tier} account\`, async () => {});
    if (tier === 'professional') test('grants margin', async () => {});
  });
}
`,
      expand,
    );
    expect(cases(inventory)).toEqual([
      ['shows a live quote for AAPL', 0, 1],
      ['shows a live quote for MSFT', 1, 1],
      ['charges retail accounts 25 bps', 0, 1],
      ['charges professional accounts 10 bps', 1, 1],
      ['retail accounts > opens a retail account', null, 1],
      ['retail accounts > grants margin', null, 1],
      ['professional accounts > opens a professional account', null, 1],
      ['professional accounts > grants margin', null, 1],
    ]);
    expect(inventory.suites.map((suite) => [suite.title, suite.caseIndex])).toEqual([
      ['retail accounts', 0],
      ['professional accounts', 1],
    ]);
    expect(codes(inventory)).toEqual([]);
  });

  it('leaves a loop variable the body assigns to unknown in each pass', () => {
    const inventory = scanPlaywright(
      `${PLAYWRIGHT_IMPORT}
for (let side of ['buy', 'sell']) {
  side = side.toUpperCase();
  test(\`places a \${side} order\`, async () => {});
}
`,
      expand,
    );
    expect(cases(inventory)).toEqual([
      ['`places a ${side} order`', 0, 1],
      ['`places a ${side} order`', 1, 1],
    ]);
  });

  it('reports a fixed title repeated by an expanded loop, and leaves loops it cannot expand as one record', () => {
    const inventory = scanPlaywright(
      `${PLAYWRIGHT_IMPORT}
const SIDES = ['buy', 'sell'];
for (const side of SIDES) test('places an order', async () => {});
for (const side of SIDES) {
  if (side === 'sell') break;
  test(\`fills a \${side} order\`, async () => {});
}
let side;
for (side of SIDES) test(\`cancels a \${side} order\`, async () => {});
`,
      expand,
    );
    expect(cases(inventory)).toEqual([
      ['places an order', 0, 1],
      ['places an order', 1, 1],
      ['`fills a ${side} order`', null, null],
      ['`cancels a ${side} order`', null, 2],
    ]);
    expect(codes(inventory)).toEqual(['duplicate-title', 'test-in-loop', 'dynamic-title', 'dynamic-title']);
  });
});
