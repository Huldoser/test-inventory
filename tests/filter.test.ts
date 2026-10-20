import { describe, expect, it } from 'vitest';
import { filterInventory, pickTestFields, scan, type InventoryFilter } from '../src/index.ts';
import { EXAMPLES, readGolden } from './examples.ts';
import { expectValidInventory } from './helpers.ts';
import { project } from './project.ts';

const web = readGolden('trading-web');
const names = (filter: InventoryFilter) => filterInventory(web, filter).tests.map((test) => test.fullName);

describe('filterInventory', () => {
  it.each(EXAMPLES.map((example) => example.name))('returns %s unchanged for an empty filter', (name) => {
    const inventory = readGolden(name);
    expect(filterInventory(inventory, {})).toEqual(inventory);
  });

  it('keeps tests in any of the given states', () => {
    expect(names({ states: ['skip', 'expectedToFail'] })).toEqual([
      'price alerts > notifies when the price crosses above the alert',
      'price alerts > does not notify for a price that was never reached',
      'price alerts > deletes an alert',
      'backtests > exports trades to CSV',
    ]);
  });

  it('keeps tests with any of the given tags', () => {
    expect(names({ tags: ['@risk', '@backtest'] })).toEqual([
      'backtests > runs an SMA crossover backtest',
      'backtests > lists every trade the strategy made',
      'backtests > exports trades to CSV',
      'buying power > rejects an order above buying power',
      'buying power > allows an order that uses all buying power',
    ]);
  });

  it('matches the full name ignoring case, describes included', () => {
    expect(names({ grep: 'LIMIT ORDERS > .*cancel' })).toEqual(['orders > limit orders > cancels an open limit order']);
  });

  it("keeps tests that don't run and give no reason", () => {
    expect(names({ withoutReason: true })).toEqual([
      'backtests > exports trades to CSV',
      'login > asks for a one-time code on a new device',
    ]);
  });

  it('keeps only tests that pass every condition', () => {
    expect(names({ states: ['fixme'], tags: ['@smoke'] })).toEqual([
      'login > asks for a one-time code on a new device',
    ]);
  });

  it('keeps the describes around the tests, outermost first, and counts the summary over them', () => {
    const filtered = filterInventory(web, { grep: 'far from the last trade' });
    expectValidInventory(filtered);
    expect(filtered.suites.map((suite) => suite.path)).toEqual([['orders'], ['orders', 'limit orders']]);
    expect(filtered.summary).toMatchObject({
      fileCount: web.summary.fileCount,
      suiteCount: 2,
      testCount: 1,
      activeCount: 0,
      fixmeCount: 1,
      diagnosticCount: 0,
      tagCounts: { '@orders': 1 },
    });
  });

  it('keeps the diagnostics of the tests and the ones about no test, except in files left out', async () => {
    const root = project({
      'tests/market-hours.spec.ts': `import { test } from '@playwright/test';
const venue = process.env.VENUE;
test.describe(\`\${venue} hours\`, () => {
  test('opens the market', async () => {});
});
`,
      'tests/orders.spec.ts': `import { test } from '@playwright/test';
test.only('fills a market order', async () => {});
test.skip('fills a stop order', async () => {});
`,
      'tests/quotes.spec.ts': `import { test } from '@playwright/test';
test('shows a quote for', async () => {
`,
    });
    const inventory = await scan({ patterns: ['tests/*.spec.ts'], framework: 'playwright', root });
    const codes = (filter: InventoryFilter) =>
      filterInventory(inventory, filter).diagnostics.map(({ code, relativeFilePath }) => [code, relativeFilePath]);

    expect(codes({ only: true })).toEqual([
      ['unknown-framework-version', 'package.json'],
      ['parse-error', 'tests/quotes.spec.ts'],
    ]);
    expect(codes({ grep: 'opens the market' })).toEqual([
      ['unknown-framework-version', 'package.json'],
      ['dynamic-title', 'tests/market-hours.spec.ts'],
      ['parse-error', 'tests/quotes.spec.ts'],
    ]);
  });

  it.each<[unknown, string]>([
    [null, 'filter must be an object.'],
    [{ state: ['skip'] }, 'filter can only have the keys states, tags, grep, only, withoutReason; got "state".'],
    [
      { states: ['skipped'] },
      'filter.states can only hold "active", "skip", "fixme", "todo", "expectedToFail", "notLoaded"; got "skipped".',
    ],
    [
      { states: 'skip' },
      'filter.states can only hold "active", "skip", "fixme", "todo", "expectedToFail", "notLoaded"; got "skip".',
    ],
    [{ tags: ['@smoke', undefined] }, 'filter.tags can only hold non-empty strings; got undefined.'],
    [{ tags: [''] }, 'filter.tags can only hold non-empty strings; got "".'],
    [{ grep: '' }, 'filter.grep must be a non-empty string.'],
    [
      { grep: 'fills (a market' },
      'filter.grep must be a regular expression: Invalid regular expression: /fills (a market/i: Unterminated group.',
    ],
    [{ only: 'yes' }, 'filter.only must be true or false.'],
    [{ withoutReason: 1 }, 'filter.withoutReason must be true or false.'],
  ])('throws a TypeError for %j', (filter, message) => {
    expect(() => filterInventory(web, filter as InventoryFilter)).toThrow(new TypeError(message));
  });
});

describe('pickTestFields', () => {
  it('keeps id and the given keys, in that order, once each', () => {
    const picked = pickTestFields(web, ['state', 'fullName', 'id', 'state']);
    expect(picked.tests[0]).toEqual({
      id: web.tests[0].id,
      state: 'skip',
      fullName: 'price alerts > notifies when the price crosses above the alert',
    });
    expect(Object.keys(picked.tests[0])).toEqual(['id', 'state', 'fullName']);
    expect({ ...picked, tests: [] }).toEqual({ ...web, tests: [] });
  });

  it.each<[unknown, string]>([
    [[], 'fields must be a non-empty array of test record keys.'],
    ['fullName', 'fields must be a non-empty array of test record keys.'],
    [['fullName', 'owner'], 'fields can only hold keys of a test record, such as "fullName"; got "owner".'],
    [['fullName', undefined], 'fields can only hold keys of a test record, such as "fullName"; got undefined.'],
  ])('throws a TypeError for %j', (fields, message) => {
    expect(() => pickTestFields(web, fields as 'id'[])).toThrow(new TypeError(message));
  });
});
