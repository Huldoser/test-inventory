import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, type Inventory, type TestRecord } from '../src/index.ts';
import { expectValidInventory, scanPlaywright } from './helpers.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

const FIXTURES = `import { test as base } from '@playwright/test';
import { OrderTicket } from '../pages/order-ticket';
import { OrdersBlotter } from '../pages/orders-blotter';

export const test = base.extend<{ orderTicket: OrderTicket; blotter: OrdersBlotter }>({
  orderTicket: async ({ page }, use) => {
    await use(new OrderTicket(page));
  },
  blotter: async ({ page }, use) => {
    await use(new OrdersBlotter(page));
  },
});
export { expect } from '@playwright/test';
`;

const ORDER_TICKET = `import type { Page } from '@playwright/test';
import { TRADER } from '../test-data/accounts';

export class OrderTicket {
  constructor(private readonly page: Page) {}

  async open(symbol: string) {
    await this.page.goto(\`/trade/\${symbol}?account=\${TRADER.account}\`);
  }
}
`;

const BLOTTER = `import type { Page } from '@playwright/test';

export class OrdersBlotter {
  constructor(private readonly page: Page) {}

  status(symbol: string) {
    return this.page.getByTestId(\`order-status-\${symbol}\`);
  }
}
`;

const LIMIT_ORDERS = `import { test, expect } from '../fixtures';
import { LIMIT_PRICES } from '../test-data/prices';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('limit orders', { tag: '@orders' }, () => {
  test.beforeEach(async ({ orderTicket }) => {
    await orderTicket.open('AAPL');
  });

  test('places a limit buy order for AAPL', async ({ blotter }) => {
    await expect(blotter.status('AAPL')).toHaveText('Working');
  });

  test('rejects a limit price far from the last trade', async ({ blotter }) => {
    await expect(blotter.status('AAPL')).toHaveText(\`Rejected at \${LIMIT_PRICES.far}\`);
  });
});
`;

const TRADING_WEB = {
  'package.json': PLAYWRIGHT_PACKAGE,
  'fixtures/index.ts': FIXTURES,
  'pages/order-ticket.ts': ORDER_TICKET,
  'pages/orders-blotter.ts': BLOTTER,
  'pages/watchlist-page.ts': 'export class WatchlistPage {\n  readonly symbols: string[] = [];\n}\n',
  'test-data/accounts.ts': "export const TRADER = { account: 'PAPER-7741' };\n",
  'test-data/prices.ts': 'export const LIMIT_PRICES = { near: 187.5, far: 1 };\n',
  'tests/limit-orders.spec.ts': LIMIT_ORDERS,
};

async function scanProject(root: string, framework: 'playwright' | 'vitest' = 'playwright'): Promise<Inventory> {
  const patterns =
    framework === 'playwright' ? ['tests/**/*.spec.ts'] : ['tests/**/*.test.{ts,tsx}', 'tests/**/*.test-d.ts'];
  const inventory = await scan({ root, patterns, framework });
  expectValidInventory(inventory);
  return inventory;
}

function byTitle(inventory: Inventory, title: string): TestRecord {
  return inventory.tests.find((test) => test.title === title) as TestRecord;
}

/** The hash of each test, by title, after a change to one file. */
async function hashesAfter(
  files: Record<string, string>,
  change: [string, string] | null,
  framework: 'playwright' | 'vitest' = 'playwright',
): Promise<Record<string, string>> {
  const root = project(files);
  if (change) writeFileSync(path.join(root, change[0]), change[1]);
  const inventory = await scanProject(root, framework);
  return Object.fromEntries(inventory.tests.map((test) => [test.title, test.dependencyHash]));
}

describe('dependencyHash', () => {
  it('lists the files a test reaches through its fixtures, page objects and test data, and leaves out the rest', async () => {
    const inventory = await scanProject(project(TRADING_WEB));
    expect(byTitle(inventory, 'places a limit buy order for AAPL')).toMatchObject({
      dependencies: [
        'fixtures/index.ts',
        'pages/order-ticket.ts',
        'pages/orders-blotter.ts',
        'test-data/accounts.ts',
        'tests/limit-orders.spec.ts',
      ],
      hasUnfollowedDependencies: false,
    });
    expect(byTitle(inventory, 'rejects a limit price far from the last trade').dependencies).toContain(
      'test-data/prices.ts',
    );
    expect(inventory.diagnostics).toEqual([]);
  });

  it('changes when code the test reaches changes, and not for formatting, comments or code it does not reach', async () => {
    const before = await hashesAfter(TRADING_WEB, null);
    const reformatted = await hashesAfter(TRADING_WEB, [
      'pages/orders-blotter.ts',
      BLOTTER.replace('status(symbol: string) {', '// The blotter row of an order.\n  status (symbol: string)\n  {'),
    ]);
    const watchlist = await hashesAfter(TRADING_WEB, [
      'pages/watchlist-page.ts',
      "export class WatchlistPage {\n  readonly symbols: string[] = ['AAPL'];\n}\n",
    ]);
    const account = await hashesAfter(TRADING_WEB, [
      'test-data/accounts.ts',
      "export const TRADER = { account: 'PAPER-7742' };\n",
    ]);
    const prices = await hashesAfter(TRADING_WEB, [
      'test-data/prices.ts',
      'export const LIMIT_PRICES = { near: 187.5, far: 2 };\n',
    ]);
    expect(reformatted).toEqual(before);
    expect(watchlist).toEqual(before);
    expect(Object.values(account).every((hash, index) => hash !== Object.values(before)[index])).toBe(true);
    expect(prices['places a limit buy order for AAPL']).toBe(before['places a limit buy order for AAPL']);
    expect(prices['rejects a limit price far from the last trade']).not.toBe(
      before['rejects a limit price far from the last trade'],
    );
  });

  it("covers the hooks and options of the file and every describe around the test, but not another test's code", async () => {
    const title = 'places a limit buy order for AAPL';
    const before = await hashesAfter(TRADING_WEB, null);
    const changes: [string, boolean][] = [
      [LIMIT_ORDERS.replace("await page.goto('/');", "await page.goto('/trade');"), true],
      [LIMIT_ORDERS.replace("{ tag: '@orders' }", "{ tag: '@limit' }"), true],
      [LIMIT_ORDERS.replace("orderTicket.open('AAPL')", "orderTicket.open('MSFT')"), true],
      [LIMIT_ORDERS.replace("toHaveText('Working')", "toHaveText('Filled')"), true],
      [LIMIT_ORDERS.replace('Rejected at', 'Rejected above'), false],
    ];
    for (const [code, changes_] of changes) {
      const after = await hashesAfter(TRADING_WEB, ['tests/limit-orders.spec.ts', code]);
      expect(after[title] !== before[title], code).toBe(changes_);
    }
  });

  it('is the same for a test that moves to another line, as its id is', async () => {
    const before = await hashesAfter(TRADING_WEB, null);
    const moved = await hashesAfter(TRADING_WEB, [
      'tests/limit-orders.spec.ts',
      LIMIT_ORDERS.replace("test.describe('limit orders'", "\n\ntest.describe('limit orders'"),
    ]);
    expect(moved).toEqual(before);
  });

  it('follows names by scope: a local name that hides a constant of the file does not bring the constant in', () => {
    const inventory = scanPlaywright(`import { test, expect } from '@playwright/test';
const SYMBOL = 'AAPL';
function quoteUrl(symbol: string) {
  return \`/quotes/\${symbol}\`;
}

test('opens the AAPL quote', async ({ page }) => {
  await page.goto(quoteUrl(SYMBOL));
});

test('opens the MSFT quote', async ({ page }) => {
  const SYMBOL = 'MSFT';
  await page.goto(\`/quotes/\${SYMBOL}\`);
});
`);
    const changed = scanPlaywright(`import { test, expect } from '@playwright/test';
const SYMBOL = 'NVDA';
function quoteUrl(symbol: string) {
  return \`/quotes/\${symbol}\`;
}

test('opens the AAPL quote', async ({ page }) => {
  await page.goto(quoteUrl(SYMBOL));
});

test('opens the MSFT quote', async ({ page }) => {
  const SYMBOL = 'MSFT';
  await page.goto(\`/quotes/\${SYMBOL}\`);
});
`);
    expect(changed.tests[0].dependencyHash).not.toBe(inventory.tests[0].dependencyHash);
    expect(changed.tests[1].dependencyHash).toBe(inventory.tests[1].dependencyHash);
    expect(inventory.tests.map((test) => [test.dependencies, test.hasUnfollowedDependencies])).toEqual([
      [['tests/orders.spec.ts'], false],
      [['tests/orders.spec.ts'], false],
    ]);
  });

  it('gives each call of a helper that declares a test its own hash, from the arguments of the call', async () => {
    const files = {
      'package.json': PLAYWRIGHT_PACKAGE,
      'helpers/orders.ts': `import { test } from '@playwright/test';
export function rejectsZeroQuantity(side: string) {
  test(\`\${side} rejects a zero quantity\`, async ({ page }) => {
    await page.getByRole('button', { name: side }).click();
  });
}
`,
      'tests/orders.spec.ts': `import { test } from '@playwright/test';
import { rejectsZeroQuantity } from '../helpers/orders';
rejectsZeroQuantity('buy');
rejectsZeroQuantity('sell');

test.describe('order ticket', () => {
  rejectsZeroQuantity('short');
  test('opens the ticket', async ({ page }) => {
    await page.getByRole('button', { name: 'Trade' }).click();
  });
});
`,
    };
    const inventory = await scanProject(project(files));
    const [buy, sell] = inventory.tests;
    expect(buy.bodyHash).toBe(sell.bodyHash);
    expect(buy.dependencyHash).not.toBe(sell.dependencyHash);
    expect(buy.dependencies).toEqual(['helpers/orders.ts', 'tests/orders.spec.ts']);
    expect(byTitle(inventory, 'opens the ticket').dependencies).toEqual(['tests/orders.spec.ts']);
    const before = await hashesAfter(files, null);
    const after = await hashesAfter(files, [
      'tests/orders.spec.ts',
      files['tests/orders.spec.ts'].replace("rejectsZeroQuantity('short')", "rejectsZeroQuantity('cover')"),
    ]);
    expect(after['opens the ticket']).toBe(before['opens the ticket']);
    expect(after['buy rejects a zero quantity']).toBe(before['buy rejects a zero quantity']);
  });

  it('takes only the export a namespace import names, and the whole module when the name is computed', async () => {
    const files = {
      'package.json': PLAYWRIGHT_PACKAGE,
      'test-data/symbols.ts': "export const EQUITIES = ['AAPL', 'MSFT'];\nexport const FUTURES = ['ES', 'NQ'];\n",
      'tests/quotes.spec.ts': `import { test } from '@playwright/test';
import * as symbols from '../test-data/symbols';

test('quotes every equity', async ({ page }) => {
  for (const symbol of symbols.EQUITIES) await page.goto(\`/quotes/\${symbol}\`);
});

test('quotes the chosen market', async ({ page }) => {
  const market = process.env.MARKET ?? 'EQUITIES';
  for (const symbol of symbols[market as 'EQUITIES']) await page.goto(\`/quotes/\${symbol}\`);
});
`,
    };
    const before = await hashesAfter(files, null);
    const after = await hashesAfter(files, [
      'test-data/symbols.ts',
      "export const EQUITIES = ['AAPL', 'MSFT'];\nexport const FUTURES = ['ES', 'NQ', 'CL'];\n",
    ]);
    expect(after['quotes every equity']).toBe(before['quotes every equity']);
    expect(after['quotes the chosen market']).not.toBe(before['quotes the chosen market']);
  });

  it('takes every export of a barrel used with a computed key, through its re-exports, but not types', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'test-data/index.ts': [
        "export { EQUITIES } from './equities';",
        "export * from './futures';",
        "export type { Market } from './market-types';",
        "export type * from './order-types';",
        "const DEFAULT_MARKET = 'EQUITIES';",
        'export { DEFAULT_MARKET as defaultMarket };',
        '',
      ].join('\n'),
      'test-data/equities.ts': "export const EQUITIES = ['AAPL', 'MSFT'];\n",
      'test-data/futures.ts': "export const FUTURES = ['ES', 'NQ'];\n",
      'test-data/market-types.ts': "export type Market = 'EQUITIES' | 'FUTURES';\n",
      'test-data/order-types.ts': "export type Side = 'buy' | 'sell';\n",
      'tests/quotes.spec.ts': `import { test } from '@playwright/test';
import * as markets from '../test-data';

test('quotes the chosen market', async ({ page }) => {
  for (const symbol of markets[process.env.MARKET as 'EQUITIES']) await page.goto(\`/quotes/\${symbol}\`);
});
`,
    });
    const inventory = await scanProject(root);
    expect(inventory.tests[0].dependencies).toEqual([
      'test-data/equities.ts',
      'test-data/futures.ts',
      'test-data/index.ts',
      'tests/quotes.spec.ts',
    ]);
  });

  it('follows re-exports, default exports and barrels, and stops at a cycle', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'test-data/index.ts': [
        "export * from './legacy-accounts';",
        "export * from './accounts';",
        "export { default as venue } from './venue';",
        "export * as markets from './markets';",
        "export type { Account } from './account-types';",
        'export { structuredClone as cloneOrder };',
        '',
      ].join('\n'),
      'test-data/legacy-accounts.ts': 'export const LEGACY = ;\n',
      'test-data/accounts.ts': "export * from './index';\nexport const TRADER = { account: 'PAPER-7741' };\n",
      'test-data/venue.ts': "const NASDAQ = 'XNAS';\nexport default NASDAQ;\n",
      'test-data/markets.ts': "export const EQUITIES = ['AAPL', 'MSFT'];\n",
      'test-data/account-types.ts': 'export interface Account {\n  account: string;\n}\n',
      'tests/routing.spec.ts': `import { test } from '@playwright/test';
import { TRADER, venue, markets, cloneOrder } from '../test-data';

test('routes a paper order to NASDAQ', async ({ page }) => {
  const order = cloneOrder({ symbol: markets.EQUITIES[0] });
  await page.goto(\`/route?account=\${TRADER.account}&venue=\${venue}&symbol=\${order.symbol}\`);
});
`,
    });
    const inventory = await scanProject(root);
    expect(inventory.tests[0].dependencies).toEqual([
      'test-data/accounts.ts',
      'test-data/markets.ts',
      'test-data/venue.ts',
      'tests/routing.spec.ts',
    ]);
    // Loading the barrel runs the module that doesn't parse; a type-only re-export runs nothing.
    expect(inventory.diagnostics.map(({ relativeFilePath, message }) => [relativeFilePath, message])).toEqual([
      ['test-data/index.ts', "'./legacy-accounts' could not be parsed, so dependencyHash doesn't cover it."],
    ]);
  });

  it('follows enums, namespaces and components, and not labels or plain HTML elements', async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'src/order-ticket.tsx':
        'export function OrderTicket({ symbol }: { symbol: string }) {\n  return <form>{symbol}</form>;\n}\n',
      'src/ticket-parts.tsx': 'export function Footer() {\n  return <footer>Paper account</footer>;\n}\n',
      'tests/order-ticket.test.tsx': `import { expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { OrderTicket } from '../src/order-ticket';
import * as Ticket from '../src/ticket-parts';

enum Side {
  Buy = 'buy',
  Sell = 'sell',
}
namespace Fees {
  export const EQUITY = 0.005;
}

test('shows the buy side and the equity fee', () => {
  const view = render(
    <div className="desk">
      <OrderTicket symbol="AAPL" />
      <Ticket.Footer />
    </div>,
  );
  rows: for (const row of view.getAllByRole('row')) {
    if (row.textContent?.includes(Side.Buy)) break rows;
  }
  expect(view.getByText(String(Fees.EQUITY))).toBeTruthy();
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    expect(inventory.tests[0].dependencies).toEqual([
      'src/order-ticket.tsx',
      'src/ticket-parts.tsx',
      'tests/order-ticket.test.tsx',
    ]);
    const before = await hashesAfter(files, null, 'vitest');
    for (const [from, to] of [
      ["Sell = 'sell'", "Sell = 'short'"],
      ['EQUITY = 0.005', 'EQUITY = 0.004'],
    ]) {
      const code = files['tests/order-ticket.test.tsx'].replace(from, to);
      const after = await hashesAfter(files, ['tests/order-ticket.test.tsx', code], 'vitest');
      expect(after, to).not.toEqual(before);
    }
  });

  it('takes the code a module runs when it loads, and a whole module loaded by path at run time', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'support/matchers.ts': `import { expect } from '@playwright/test';
export const NOT_USED = 1;
expect.extend({
  toBeAPrice(received: string) {
    return { pass: /^\\d+\\.\\d{2}$/.test(received), message: () => 'not a price' };
  },
});
`,
      'support/feeds.cjs': "module.exports = { primary: 'wss://feed.example.test' };\n",
      'support/market-hours.ts': "export const OPEN = '09:30';\n",
      'test-data/fees.json': '{ "equity": 0.005 }\n',
      'tests/pricing.spec.ts': `import { test, expect } from '@playwright/test';
import '../support/matchers';
import fees from '../test-data/fees.json';

test('shows the fee as a price', async ({ page }) => {
  const feeds = require('../support/feeds.cjs');
  const { OPEN } = await import('../support/market-hours');
  await page.goto(\`/fees?feed=\${feeds.primary}&open=\${OPEN}\`);
  await expect(page.getByTestId('fee')).toHaveText(String(fees.equity));
});
`,
    });
    const inventory = await scanProject(root);
    expect(inventory.tests[0]).toMatchObject({
      dependencies: [
        'support/feeds.cjs',
        'support/market-hours.ts',
        'support/matchers.ts',
        'test-data/fees.json',
        'tests/pricing.spec.ts',
      ],
      hasUnfollowedDependencies: false,
    });
  });

  it('marks a test that reaches what it cannot follow, and reports each place once per scan', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'support/venues.ts': `export async function venueConfig(venue: string, ...fallbacks: string[]) {
  return fallbacks.length > 0 ? require(...fallbacks) : import(\`./venues/\${venue}\`);
}
`,
      'tests/nasdaq.spec.ts': `import { test } from '@playwright/test';
import { venueConfig } from '../support/venues';
import { BROKER } from '../support/missing';

test('routes to NASDAQ', async () => {
  await venueConfig('nasdaq');
});

test('routes through the broker', async () => {
  console.log(BROKER);
});
`,
      'tests/nyse.spec.ts': `import { test } from '@playwright/test';
import { venueConfig } from '../support/venues';

test('routes to NYSE', async () => {
  await venueConfig('nyse');
});
`,
      'tests/quotes.spec.ts': `import { test, expect } from '@playwright/test';

test('quotes AAPL', async ({ page }) => {
  await expect(page.getByTestId('AAPL')).toBeVisible();
});
`,
    });
    const inventory = await scanProject(root);
    expect(inventory.tests.map((test) => [test.title, test.hasUnfollowedDependencies])).toEqual([
      ['routes to NASDAQ', true],
      ['routes through the broker', true],
      ['routes to NYSE', true],
      ['quotes AAPL', false],
    ]);
    expect(
      inventory.diagnostics.map(({ code, level, relativeFilePath, lineStart, message }) => [
        code,
        level,
        relativeFilePath,
        lineStart,
        message,
      ]),
    ).toEqual([
      [
        'dependency-not-followed',
        'warning',
        'tests/nasdaq.spec.ts',
        3,
        "'../support/missing' could not be read, so dependencyHash doesn't cover it.",
      ],
      [
        'dependency-not-followed',
        'warning',
        'support/venues.ts',
        2,
        "The module this loads is worked out at run time, so dependencyHash doesn't cover it.",
      ],
      [
        'dependency-not-followed',
        'warning',
        'support/venues.ts',
        2,
        "The module this loads is worked out at run time, so dependencyHash doesn't cover it.",
      ],
    ]);
  });

  it('leaves out installed packages without a warning', async () => {
    const inventory = await scanProject(
      project({
        'package.json': PLAYWRIGHT_PACKAGE,
        'node_modules/@trading/quotes/package.json': JSON.stringify({ name: '@trading/quotes', main: 'index.js' }),
        'node_modules/@trading/quotes/index.js': 'exports.formatQuote = (price) => price.toFixed(2);\n',
        'tests/quotes.spec.ts': `import { test, expect } from '@playwright/test';
import { formatQuote } from '@trading/quotes';

test('formats the AAPL quote', async ({ page }) => {
  await expect(page.getByTestId('AAPL')).toHaveText(formatQuote(187.5));
});
`,
      }),
    );
    expect(inventory.tests[0]).toMatchObject({
      dependencies: ['tests/quotes.spec.ts'],
      hasUnfollowedDependencies: false,
    });
    expect(inventory.diagnostics).toEqual([]);
  });

  it('follows the types a type test uses, and leaves types out for other tests', async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'src/orders.ts': `export interface Order {
  symbol: string;
  quantity: number;
}
export function limitOrder(symbol: string, quantity: number): Order {
  return { symbol, quantity };
}
`,
      'tests/orders.test-d.ts': `import { expectTypeOf, test } from 'vitest';
import type * as orders from '../src/orders';

type Pending<T extends orders.Order> = T & { status: 'pending' };
interface Filled {
  status: 'filled';
}

test('an order has a symbol', () => {
  expectTypeOf<Pending<orders.Order>>().toHaveProperty('symbol');
  expectTypeOf<Filled>().toHaveProperty('status');
});
`,
      'tests/orders.test.ts': `import { expect, test } from 'vitest';
import { limitOrder, type Order } from '../src/orders';

test('builds a limit order', () => {
  const order: Order = limitOrder('AAPL', 10);
  expect(order.quantity).toBe(10);
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    expect(inventory.tests.map((test) => [test.title, test.dependencies])).toEqual([
      ['an order has a symbol', ['src/orders.ts', 'tests/orders.test-d.ts']],
      ['builds a limit order', ['src/orders.ts', 'tests/orders.test.ts']],
    ]);
    const before = await hashesAfter(files, null, 'vitest');
    const after = await hashesAfter(
      files,
      [
        'src/orders.ts',
        files['src/orders.ts'].replace('quantity: number;\n}', 'quantity: number;\n  venue?: string;\n}'),
      ],
      'vitest',
    );
    expect(after['an order has a symbol']).not.toBe(before['an order has a symbol']);
    expect(after['builds a limit order']).toBe(before['builds a limit order']);
  });

  it("marks a test whose local imports one file's code can't follow, without a warning", () => {
    const accounts = scanPlaywright(`import { test } from '@playwright/test';
import { TRADER } from '../test-data/accounts';
test('places a market order', async ({ page }) => {
  await page.goto(\`/trade?account=\${TRADER.account}\`);
});
`);
    const packages = scanPlaywright(`import { test, expect } from '@playwright/test';
test('places a market order', async ({ page }) => {
  await expect(page.getByTestId('order-status')).toHaveText('Filled');
});
`);
    expect(accounts.tests[0].hasUnfollowedDependencies).toBe(true);
    expect(packages.tests[0].hasUnfollowedDependencies).toBe(false);
    expect([...accounts.diagnostics, ...packages.diagnostics]).toEqual([]);
  });
});
