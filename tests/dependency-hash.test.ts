import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, type Inventory, type TestRecord } from '../src/index.ts';
import { expectValidInventory, scanPlaywright, scanVitest } from './helpers.ts';
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
      [
        'dependency-not-followed',
        'warning',
        'tests/nasdaq.spec.ts',
        3,
        "'../support/missing' could not be read, so dependencyHash doesn't cover it.",
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

  it('reads a class decorated before export, and follows what the decorator uses', async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'src/registry.ts': "export const SERVICES = { orders: 'order-service' };\n",
      'src/order-service.ts': `import { SERVICES } from './registry';
declare function injectable(pick: (registry: Map<string, unknown>) => unknown): ClassDecorator;

@injectable((registry) => registry.get(SERVICES.orders))
export class OrderService {
  place(symbol: string) {
    return \`placed \${symbol}\`;
  }
}
`,
      'tests/order-service.test.ts': `import { expect, test } from 'vitest';
import { OrderService } from '../src/order-service';

test('places an order for AAPL', () => {
  expect(new OrderService().place('AAPL')).toBe('placed AAPL');
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    expect(inventory.diagnostics).toEqual([]);
    expect(inventory.tests[0].dependencies).toEqual([
      'src/order-service.ts',
      'src/registry.ts',
      'tests/order-service.test.ts',
    ]);
  });

  it('takes declarations that run code when the file loads, as a seeded exchange or a registered strategy', async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'src/exchange.ts':
        'export function seedExchange(symbols: string[]) {\n  return symbols.map((symbol) => ({ symbol, bid: 100 }));\n}\n',
      'src/strategies.ts':
        'export const registered: string[] = [];\nexport function register(name: string) {\n  registered.push(name);\n  return name;\n}\n',
      'src/momentum.ts': "import { register } from './strategies';\nexport default register('momentum');\n",
      'tests/exchange.test.ts': `import { expect, test } from 'vitest';
import { seedExchange } from '../src/exchange';
import { registered } from '../src/strategies';
import '../src/momentum';

const seeded = seedExchange(['AAPL']);

test('lists the registered strategies', () => {
  expect(registered).toEqual(['momentum']);
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    expect(inventory.tests[0].dependencies).toEqual([
      'src/exchange.ts',
      'src/momentum.ts',
      'src/strategies.ts',
      'tests/exchange.test.ts',
    ]);
    const before = await hashesAfter(files, null, 'vitest');
    const after = await hashesAfter(
      files,
      ['src/momentum.ts', files['src/momentum.ts'].replace("'momentum'", "'mean-reversion'")],
      'vitest',
    );
    expect(after).not.toEqual(before);
  });

  it('follows import = require() and a namespace exported by name', async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'src/fees.ts': 'export const EQUITY_FEE = 0.005;\n',
      'src/pricing.ts': 'namespace Pricing {\n  export const SPREAD = 0.01;\n}\nexport { Pricing };\n',
      'src/fee-types.ts': 'export interface Fee {\n  rate: number;\n}\n',
      'tests/fees.test.ts': `import { expect, test } from 'vitest';
import fees = require('../src/fees');
import type feeTypes = require('../src/fee-types');
import { Pricing } from '../src/pricing';
import SPREAD = Pricing.SPREAD;

test('adds the fee and the spread', () => {
  const fee: feeTypes.Fee = { rate: fees.EQUITY_FEE };
  expect(fee.rate + SPREAD).toBeCloseTo(0.015);
  expect(Object.keys(fees)).toEqual(['EQUITY_FEE']);
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    expect(inventory.tests[0]).toMatchObject({
      dependencies: ['src/fees.ts', 'src/pricing.ts', 'tests/fees.test.ts'],
      hasUnfollowedDependencies: false,
    });
  });

  it("prefers a module's own export over one from export *, which never re-exports default", async () => {
    const files = {
      'package.json': PLAYWRIGHT_PACKAGE,
      'pages/index.ts':
        "export * from './order-ticket';\nexport * from './legacy-fees';\nexport default class PageRegistry {\n  readonly pages = ['ticket'];\n}\nexport function feeFor(symbol: string) {\n  return symbol === 'AAPL' ? 0.005 : 0.01;\n}\n",
      'pages/order-ticket.ts': "export default class OrderTicket {\n  readonly symbol = 'AAPL';\n}\n",
      'pages/legacy-fees.ts': 'export function feeFor() {\n  return 0.02;\n}\n',
      'tickets/index.ts': "export * from '../pages/order-ticket';\n",
      'tests/tickets.spec.ts': `import { test, expect } from '@playwright/test';
import Ticket from '../tickets';

// tickets/index.ts has no default export of its own, and export * doesn't pass one on.
test('opens a ticket', async () => {
  expect(Ticket).toBeUndefined();
});
`,
      'tests/fees.spec.ts': `import { test, expect } from '@playwright/test';
import PageRegistry, { feeFor } from '../pages';

test('charges the AAPL fee', async () => {
  expect(new PageRegistry().pages).toContain('ticket');
  expect(feeFor('AAPL')).toBe(0.005);
});
`,
    };
    const inventory = await scanProject(project(files));
    expect(inventory.tests.map((test) => test.dependencies)).toEqual([
      ['pages/index.ts', 'tests/fees.spec.ts'],
      // The whole module is taken when the name isn't found, and its export * brings in the rest.
      ['pages/order-ticket.ts', 'tests/tickets.spec.ts', 'tickets/index.ts'],
    ]);
  });

  it('follows a component written as a member of a lowercase namespace, but not attribute names', async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'src/ui.tsx': 'export function OrderTicket() {\n  return <form />;\n}\nexport const Symbol = 1;\n',
      'tests/ui.test.tsx': `import { expect, test } from 'vitest';
import { render } from '@testing-library/react';
import * as ui from '../src/ui';

test('renders the order ticket', () => {
  expect(render(<ui.OrderTicket Symbol="AAPL" />)).toBeTruthy();
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    expect(inventory.tests[0].dependencies).toEqual(['src/ui.tsx', 'tests/ui.test.tsx']);
  });

  it("follows require() made with createRequire, Vitest's module mocks, and flags import.meta.glob", async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'src/fees.cjs': 'module.exports = { equity: 0.005 };\n',
      'src/exchange.ts': "export const connect = () => 'live';\n",
      'src/broker.ts': "export const route = () => 'NASDAQ';\n",
      'tests/venues.test.ts': `import { createRequire } from 'node:module';
import { expect, test, vi } from 'vitest';

vi.mock('../src/exchange', () => ({ connect: () => 'paper' }));
const require = createRequire(import.meta.url);

test('charges the equity fee', async () => {
  const broker = await vi.importActual<typeof import('../src/broker')>('../src/broker');
  expect(require('../src/fees.cjs').equity).toBe(0.005);
  expect(broker.route()).toBe('NASDAQ');
});

test('loads every venue', () => {
  expect(Object.keys(import.meta.glob('../src/venues/*.ts'))).not.toEqual([]);
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    expect(inventory.tests.map((test) => [test.title, test.dependencies, test.hasUnfollowedDependencies])).toEqual([
      ['charges the equity fee', ['src/broker.ts', 'src/exchange.ts', 'src/fees.cjs', 'tests/venues.test.ts'], false],
      ['loads every venue', ['src/exchange.ts', 'tests/venues.test.ts'], true],
    ]);
    expect(inventory.diagnostics.map(({ relativeFilePath, lineStart }) => [relativeFilePath, lineStart])).toEqual([
      ['tests/venues.test.ts', 14],
    ]);
  });

  it('reports a broken module behind a barrel once, in the barrel', async () => {
    const spec = (title: string) =>
      `import { test } from '@playwright/test';\nimport { OrderTicket } from '../pages';\n\ntest('${title}', async ({ page }) => {\n  await new OrderTicket(page).open();\n});\n`;
    const inventory = await scanProject(
      project({
        'package.json': PLAYWRIGHT_PACKAGE,
        'pages/index.ts': "export { OrderTicket } from './order-ticket';\n",
        'pages/order-ticket.ts': 'export class OrderTicket = ;\n',
        'tests/buy.spec.ts': spec('buys AAPL'),
        'tests/sell.spec.ts': spec('sells AAPL'),
      }),
    );
    expect(inventory.tests.every((test) => test.hasUnfollowedDependencies)).toBe(true);
    expect(
      inventory.diagnostics.map(({ relativeFilePath, lineStart, source }) => [relativeFilePath, lineStart, source]),
    ).toEqual([['pages/index.ts', 1, "export { OrderTicket } from './order-ticket';"]]);
  });

  it('keeps the hash when a test moves above or below the code it uses', () => {
    const code = `import { test, expect } from '@playwright/test';
const MAX_QUANTITY = 500;

test('rejects an order above the size limit', async ({ page }) => {
  await expect(page.getByTestId('max-quantity')).toHaveText(String(MAX_QUANTITY));
});
`;
    const moved = `import { test, expect } from '@playwright/test';

test('rejects an order above the size limit', async ({ page }) => {
  await expect(page.getByTestId('max-quantity')).toHaveText(String(MAX_QUANTITY));
});
const MAX_QUANTITY = 500;
`;
    expect(scanPlaywright(moved).tests[0].dependencyHash).toBe(scanPlaywright(code).tests[0].dependencyHash);
  });

  it("gives the tests of a describe.each their own hashes, not each other's code", () => {
    const code = (fee: string) => `import { describe, expect, test } from 'vitest';
describe.each(['NYSE', 'LSE'])('routing to %s', (venue) => {
  test('accepts a market order', () => {
    expect(venue).toMatch(/^[A-Z]+$/);
  });
  test('charges the venue fee', () => {
    expect(${fee}).toBeGreaterThan(0);
  });
});
`;
    const before = scanVitest(code('0.005'));
    const after = scanVitest(code('0.004'));
    expect(after.tests[0].dependencyHash).toBe(before.tests[0].dependencyHash);
    expect(after.tests[1].dependencyHash).not.toBe(before.tests[1].dependencyHash);
  });

  it('reads a file imported with a Vite query, and marks a value that only a declaration file describes', async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@trading/market': ['./types/market.d.ts'] } } }),
      'types/market.d.ts':
        "import './ambient.js';\nexport interface Market {\n  open: string;\n}\nexport declare const OPEN: string;\n",
      'src/boot-script.ts': "export const BOOT = 'window.__TRADING__ = true';\n",
      'tests/boot.test.ts': `import { expect, test } from 'vitest';
import script from '../src/boot-script.ts?raw';
import { Market } from '@trading/market';

test('boots the trading desk', () => {
  const market: Market = { open: '09:30' };
  expect(script).toContain('__TRADING__');
  expect(market.open).toBe('09:30');
});
`,
      'tests/market.test.ts': `import { expect, test } from 'vitest';
import { OPEN } from '@trading/market';

test('opens at half past nine', () => {
  expect(OPEN).toBe('09:30');
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    expect(inventory.tests.map((test) => [test.dependencies, test.hasUnfollowedDependencies])).toEqual([
      [['src/boot-script.ts', 'tests/boot.test.ts'], false],
      [['tests/market.test.ts'], true],
    ]);
    expect(inventory.diagnostics.map(({ relativeFilePath, message }) => [relativeFilePath, message])).toEqual([
      [
        'tests/market.test.ts',
        "'@trading/market' leads to a declaration file, so dependencyHash doesn't cover the code that runs.",
      ],
    ]);
  });

  it('follows a name through a re-export cycle the module system accepts', async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'lib/quotes.ts': "export { quote } from './barrel';\n",
      'lib/barrel.ts': "export * from './quotes';\nexport * from './nasdaq';\n",
      'lib/nasdaq.ts': 'export function quote(symbol: string) {\n  return `NASDAQ:${symbol}`;\n}\n',
      'tests/quote.test.ts': `import { expect, test } from 'vitest';
import { quote } from '../lib/quotes';

test('quotes AAPL on NASDAQ', () => {
  expect(quote('AAPL')).toBe('NASDAQ:AAPL');
});
`,
      'tests/barrel.test.ts': `import { expect, test } from 'vitest';
import { quote } from '../lib/barrel';

test('quotes MSFT on NASDAQ', () => {
  expect(quote('MSFT')).toBe('NASDAQ:MSFT');
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    // Files that only re-export have no code of their own to list.
    expect(inventory.tests.map((test) => test.dependencies)).toEqual([
      ['lib/nasdaq.ts', 'tests/barrel.test.ts'],
      ['lib/nasdaq.ts', 'tests/quote.test.ts'],
    ]);
  });

  it('follows export import = require(), and vi.mock() given an import()', async () => {
    const files = {
      'package.json': VITEST_PACKAGE,
      'src/fees.ts': 'export function commission(notional: number) {\n  return notional * 0.001;\n}\n',
      'src/broker.ts': "export import Fees = require('./fees');\n",
      'src/exchange.ts': "export const connect = () => 'live';\n",
      'tests/broker.test.ts': `import { expect, test, vi } from 'vitest';
import { Fees } from '../src/broker';

vi.mock(import('../src/exchange'), () => ({ connect: () => 'paper' }));

test('charges a tenth of a basis point', () => {
  expect(Fees.commission(100)).toBeCloseTo(0.1);
});
`,
    };
    const inventory = await scanProject(project(files), 'vitest');
    expect(inventory.tests[0]).toMatchObject({
      dependencies: ['src/exchange.ts', 'src/fees.ts', 'tests/broker.test.ts'],
      hasUnfollowedDependencies: false,
    });
  });

  it("leaves out another class's instance fields, which run only when that class is built", async () => {
    const files = {
      'package.json': PLAYWRIGHT_PACKAGE,
      'pages/trading.ts': `import type { Page } from '@playwright/test';

export class OrderTicket {
  readonly fills = new Map<string, number>();
  constructor(private readonly page: Page) {}
  async buy(symbol: string) {
    await this.page.getByRole('button', { name: \`Buy \${symbol}\` }).click();
  }
}

const KIND = 'kind';

export class Watchlist {
  readonly symbols = new Set<string>();
  readonly [KIND] = 'watchlist';
  add(symbol: string) {
    this.symbols.add(symbol);
  }
}
`,
      'tests/orders.spec.ts': `import { test } from '@playwright/test';
import { OrderTicket } from '../pages/trading';

test('buys AAPL', async ({ page }) => {
  await new OrderTicket(page).buy('AAPL');
});
`,
    };
    const before = await hashesAfter(files, null);
    const method = await hashesAfter(files, [
      'pages/trading.ts',
      files['pages/trading.ts'].replace('this.symbols.add(symbol);', 'this.symbols.add(symbol.toUpperCase());'),
    ]);
    const field = await hashesAfter(files, [
      'pages/trading.ts',
      files['pages/trading.ts'].replace('new Map<string, number>()', 'new Map<string, number>([["AAPL", 0]])'),
    ]);
    expect(method).toEqual(before);
    expect(field).not.toEqual(before);
  });

  describe('fixtures', () => {
    const FIXTURES_WITH_AUTH = `import { test as base } from '@playwright/test';
import { OrderTicket } from '../pages/order-ticket';
import { OrdersBlotter } from '../pages/orders-blotter';
import { WatchlistPage } from '../pages/watchlist-page';
import { signedInPage } from './auth';

export const test = base.extend<{
  signedInPage: unknown;
  orderTicket: OrderTicket;
  blotter: OrdersBlotter;
  watchlistPage: WatchlistPage;
  auditLog: void;
  account: string;
}>({
  signedInPage,
  account: ['PAPER-7741', { option: true }],
  orderTicket: async ({ signedInPage, account }, use) => {
    await use(new OrderTicket(signedInPage, account));
  },
  blotter: async ({ signedInPage }, use) => {
    await use(new OrdersBlotter(signedInPage));
  },
  watchlistPage: async ({ signedInPage }, use) => {
    await use(new WatchlistPage(signedInPage));
  },
  auditLog: [
    async ({}, use) => {
      await use();
    },
    { auto: true },
  ],
});
export { expect } from '@playwright/test';
`;

    const files = {
      'package.json': PLAYWRIGHT_PACKAGE,
      'fixtures/index.ts': FIXTURES_WITH_AUTH,
      'fixtures/auth.ts': `import type { Page } from '@playwright/test';
export async function signedInPage({ page }: { page: Page }, use: (page: Page) => Promise<void>) {
  await page.goto('/login');
  await use(page);
}
`,
      'pages/order-ticket.ts':
        'export class OrderTicket {\n  constructor(readonly page: unknown, readonly account: string) {}\n}\n',
      'pages/orders-blotter.ts': 'export class OrdersBlotter {\n  constructor(readonly page: unknown) {}\n}\n',
      'pages/watchlist-page.ts': 'export class WatchlistPage {\n  constructor(readonly page: unknown) {}\n}\n',
      'tests/orders.spec.ts': `import { test, expect } from '../fixtures';

test.describe('order ticket', () => {
  test.beforeAll(async ({ account }) => {
    expect(account).toMatch(/^PAPER/);
  });

  test('opens the AAPL ticket', async ({ orderTicket }) => {
    await expect(orderTicket.page).toBeTruthy();
  });

  test('shows the blotter', async ({ blotter }) => {
    await expect(blotter.page).toBeTruthy();
  });
});

test('reads every fixture', async (fixtures) => {
  await expect(fixtures).toBeTruthy();
});
`,
    };

    it('takes only the fixtures a test and its hooks ask for, those they ask for, and auto fixtures', async () => {
      const inventory = await scanProject(project(files));
      expect(inventory.tests.map((test) => [test.title, test.dependencies])).toEqual([
        [
          'opens the AAPL ticket',
          ['fixtures/auth.ts', 'fixtures/index.ts', 'pages/order-ticket.ts', 'tests/orders.spec.ts'],
        ],
        [
          'shows the blotter',
          ['fixtures/auth.ts', 'fixtures/index.ts', 'pages/orders-blotter.ts', 'tests/orders.spec.ts'],
        ],
        [
          'reads every fixture',
          [
            'fixtures/auth.ts',
            'fixtures/index.ts',
            'pages/order-ticket.ts',
            'pages/orders-blotter.ts',
            'pages/watchlist-page.ts',
            'tests/orders.spec.ts',
          ],
        ],
      ]);
      const before = await hashesAfter(files, null);
      const fixture = (from: string, to: string) =>
        hashesAfter(files, ['fixtures/index.ts', FIXTURES_WITH_AUTH.replace(from, to)]);
      const watchlist = await fixture('new WatchlistPage(signedInPage)', 'new WatchlistPage(signedInPage.mainFrame())');
      const blotter = await fixture('new OrdersBlotter(signedInPage)', 'new OrdersBlotter(signedInPage.mainFrame())');
      const account = await fixture("'PAPER-7741'", "'PAPER-7742'");
      const audit = await fixture('await use();', 'await use(undefined);');
      expect(watchlist['opens the AAPL ticket']).toBe(before['opens the AAPL ticket']);
      expect(watchlist['reads every fixture']).not.toBe(before['reads every fixture']);
      expect(blotter['opens the AAPL ticket']).toBe(before['opens the AAPL ticket']);
      expect(blotter['shows the blotter']).not.toBe(before['shows the blotter']);
      // The beforeAll asks for the account, and the order ticket's fixture asks for it too.
      expect(account['shows the blotter']).not.toBe(before['shows the blotter']);
      expect(Object.values(audit).every((hash, index) => hash !== Object.values(before)[index])).toBe(true);
    });

    it('follows fixtures through a chain of extend() calls across files and mergeTests()', async () => {
      const inventory = await scanProject(
        project({
          'package.json': PLAYWRIGHT_PACKAGE,
          'fixtures/market.ts': `import { test as base } from '@playwright/test';
import { QUOTES } from '../test-data/quotes';
import { HALTS } from '../test-data/halts';
export const marketTest = base.extend<{ quotes: string[]; halts: string[] }>({
  quotes: async ({}, use) => use(QUOTES),
  halts: async ({}, use) => use(HALTS),
});
`,
          'fixtures/broker.ts': `import { marketTest } from './market';
import { VENUES } from '../test-data/venues';
export const brokerTest = marketTest.extend<{ venues: string[] }>({
  venues: async ({ quotes }, use) => use(VENUES.filter((venue) => quotes.length > 0 && venue !== '')),
});
`,
          'fixtures/index.ts': `import { mergeTests, test as base } from '@playwright/test';
import { brokerTest } from './broker';
import { AUDIT } from '../test-data/audit';
const auditTest = base.extend<{ audit: string }>({ audit: AUDIT });
export const test = mergeTests(brokerTest, auditTest);
`,
          'test-data/quotes.ts': "export const QUOTES = ['AAPL 187.50'];\n",
          'test-data/halts.ts': "export const HALTS = ['GME'];\n",
          'test-data/venues.ts': "export const VENUES = ['NASDAQ', 'NYSE'];\n",
          'test-data/audit.ts': "export const AUDIT = 'on';\n",
          'tests/routing.spec.ts': `import { test } from '../fixtures';
test('routes to every venue', async ({ venues }) => {
  test.expect(venues).toHaveLength(2);
});
`,
        }),
      );
      expect(inventory.tests[0].dependencies).toEqual([
        'fixtures/broker.ts',
        'fixtures/index.ts',
        'fixtures/market.ts',
        'test-data/quotes.ts',
        'test-data/venues.ts',
        'tests/routing.spec.ts',
      ]);
    });

    it("reads Vitest's fixtures, in objects and in the builder form, with their options", () => {
      const code = `import { expect, test as base } from 'vitest';
const LEDGER = { entries: [] as string[] };
const MARKET_HOURS = { open: '09:30' };
const ORDER_BOOK = { bids: [187.5] };
const CLOCK_ZONE = 'America/New_York';
const test = base
  .extend({
    ledger: [async ({}, use) => use(LEDGER), { scope: 'file' }],
    orderBook: async ({ ledger }, use) => use({ ...ORDER_BOOK, ledger }),
  })
  .extend('marketHours', { scope: 'worker' }, async () => MARKET_HOURS)
  .extend('clock', { auto: true }, async () => CLOCK_ZONE);

test('reads the order book', ({ orderBook }) => {
  expect(orderBook.bids).toEqual([187.5]);
});

test.for([['AAPL'], ['MSFT']])('opens %s at the open', ([symbol], { marketHours }) => {
  expect(marketHours.open).toBe(symbol === 'AAPL' ? '09:30' : '09:30');
});
`;
      const hashes = (from: string, to: string) =>
        scanVitest(code.replace(from, to)).tests.map((test) => test.dependencyHash);
      const before = hashes('', '');
      const ledger = hashes('entries: []', "entries: ['opening balance']");
      const hours = hashes("open: '09:30'", "open: '04:00'");
      const clock = hashes("'America/New_York'", "'UTC'");
      expect([ledger[0] !== before[0], ledger[1] !== before[1]]).toEqual([true, false]);
      expect([hours[0] !== before[0], hours[1] !== before[1]]).toEqual([false, true]);
      expect([clock[0] !== before[0], clock[1] !== before[1]]).toEqual([true, true]);
    });

    it('takes a test object whole when its fixtures are not an object literal, or it is not a test object', async () => {
      const files = {
        'package.json': VITEST_PACKAGE,
        'src/schemas.ts': `const base = { extend: (shape: object) => shape };
export const OrderSchema = base.extend({ symbol: 'string', quantity: 'number' });
`,
        'tests/fixtures.ts': `import { test as base } from 'vitest';
const fixtures = { venue: async ({}, use: (venue: string) => Promise<void>) => use('NASDAQ') };
export const test = base.extend(fixtures);
`,
        'tests/orders.test.ts': `import { expect } from 'vitest';
import { test } from './fixtures';
import { OrderSchema } from '../src/schemas';

test('describes an order', () => {
  expect(Object.keys(OrderSchema)).toEqual(['symbol', 'quantity']);
});
`,
      };
      const before = await hashesAfter(files, null, 'vitest');
      const venue = await hashesAfter(
        files,
        ['tests/fixtures.ts', files['tests/fixtures.ts'].replace("'NASDAQ'", "'NYSE'")],
        'vitest',
      );
      const schema = await hashesAfter(
        files,
        ['src/schemas.ts', files['src/schemas.ts'].replace("'number'", "'integer'")],
        'vitest',
      );
      expect(venue).not.toEqual(before);
      expect(schema).not.toEqual(before);
    });

    it("takes every fixture when a fixture's own use of them can't be told", async () => {
      const ledger = 'ledger: async ({}, use: (entries: string[]) => Promise<void>) => use(LEDGER)';
      const inventory = await scanProject(
        project({
          'package.json': VITEST_PACKAGE,
          'test-data/ledger.ts': "export const LEDGER = ['opening balance'];\n",
          'fixtures/legacy.cjs': 'module.exports = { legacyQuotes: async ({ ledger }, use) => use(ledger) };\n',
          'fixtures/index.ts': `import { test as base } from 'vitest';
import { axeAudit } from '@trading/axe';
import { LEDGER } from '../test-data/ledger';
import { legacyQuotes } from './legacy.cjs';

const VENUE = 'NASDAQ',
  VENUES = [VENUE].map((venue) => venue.toLowerCase());
async function auditTrail(fixtures: object, use: (trail: object) => Promise<void>) {
  await use({ ...fixtures, venues: VENUES });
}
export const inlineTest = base.extend({ ${ledger}, audit: async (fixtures, use) => use(fixtures) });
export const globalTest = base.extend({ ${ledger}, fetch });
export const packageTest = base.extend({ ${ledger}, axeAudit });
export const legacyTest = base.extend({ ${ledger}, legacyQuotes });
export const localTest = base.extend({ ${ledger}, auditTrail });
`,
          'tests/audit.test.ts': `import { expect } from 'vitest';
import { globalTest, inlineTest, legacyTest, localTest, packageTest } from '../fixtures';

inlineTest('audits every fixture', ({ audit }) => expect(audit).toBeTruthy());
globalTest('fetches the quote feed', ({ fetch }) => expect(fetch).toBeTruthy());
packageTest('runs the accessibility audit', ({ axeAudit }) => expect(axeAudit).toBeTruthy());
legacyTest('reads legacy quotes', ({ legacyQuotes }) => expect(legacyQuotes).toBeTruthy());
localTest('keeps an audit trail', ({ auditTrail }) => expect(auditTrail).toBeTruthy());
`,
        }),
        'vitest',
      );
      expect(inventory.tests.map((test) => [test.title, test.dependencies.includes('test-data/ledger.ts')])).toEqual([
        ['audits every fixture', true],
        ['fetches the quote feed', true],
        ['runs the accessibility audit', true],
        ['reads legacy quotes', true],
        ['keeps an audit trail', true],
      ]);
    });

    it('takes the fixtures that built-in fixtures, conditions, test.use(), helpers and factories ask for', async () => {
      const fixtures = `import { test as base, expect as baseExpect } from '@playwright/test';
import { pageObject } from './page-objects';

const AUDIT_LOG = [async ({}, use: (log: string[]) => Promise<void>) => use(['session opened']), { auto: true }] as const;

export const test = base.extend<any>({
  workerStorageState: [async ({}, use) => use('auth/trader.json'), { scope: 'worker' }],
  storageState: ({ workerStorageState }, use) => use(workerStorageState),
  tradingAccount: ['margin', { option: true }],
  marginAccount: async ({}, use) => use({ limit: 50_000 }),
  accountId: async ({}, use) => use('PAPER-7741'),
  quotes: async ({}, use) => use(['AAPL 187.50']),
  blotter: pageObject('blotter'),
  auditLog: AUDIT_LOG,
});
export const empty = base.extend();
export const expect = baseExpect.extend({
  async toHaveOrderStatus(locator: { textContent(): Promise<string> }, status: string) {
    return { pass: (await locator.textContent()) === status, message: () => \`expected \${status}\` };
  },
});
`;
      const files = {
        'package.json': PLAYWRIGHT_PACKAGE,
        'fixtures/index.ts': fixtures,
        'fixtures/page-objects.ts': `export function pageObject(name: string) {
  return async ({ page, quotes }: { page: unknown; quotes: string[] }, use: (value: object) => Promise<void>) =>
    use({ name, page, quotes });
}
`,
        'fixtures/steps.ts': `export async function placeLimitBuy({ accountId }: { accountId: string }) {
  return accountId;
}
export async function signInTrader({ accountId }: { accountId: string }) {
  return accountId;
}
export function signInBeforeEach(t: { beforeEach(fn: (fixtures: { accountId: string }) => Promise<void>): void }) {
  t.beforeEach(async ({ accountId }) => {
    void accountId;
  });
}
`,
        'tests/positions.spec.ts': `import { test, expect } from '../fixtures';

test('shows the positions page', async ({ page }) => {
  await expect(page.getByTestId('status')).toHaveOrderStatus('Open');
});
`,
        'tests/margin.spec.ts': `import { test } from '../fixtures';

const MARGIN_DEFAULTS = { locale: 'en-US' };

test.describe('margin', () => {
  test.skip(({ tradingAccount }) => tradingAccount === 'cash', 'margin accounts only');
  test.use({ ...MARGIN_DEFAULTS, orderTicket: async ({ page, marginAccount }, use) => use({ page, marginAccount }) });
  test('buys on margin', async ({ orderTicket }) => {
    await orderTicket;
  });
});
`,
        'tests/steps.spec.ts': `import { test } from '../fixtures';
import { placeLimitBuy, signInBeforeEach, signInTrader } from '../fixtures/steps';

test.beforeEach(signInTrader);
signInBeforeEach(test);
test('places a limit buy order via a step', placeLimitBuy);
test('reads the blotter', async ({ blotter }) => {
  await blotter;
});
`,
      };
      // `empty`, an extend() with no fixtures, is read without a crash.
      expect((await scanProject(project(files))).diagnostics).toEqual([]);
      const before = await hashesAfter(files, null);
      const changed = (from: string, to: string) =>
        hashesAfter(files, ['fixtures/index.ts', fixtures.replace(from, to)]);
      const cases: [string, string, string][] = [
        ["'auth/trader.json'", "'auth/admin.json'", 'shows the positions page'],
        ['=== status', '!== status', 'shows the positions page'],
        ["['margin', { option: true }]", "['cash', { option: true }]", 'buys on margin'],
        ['limit: 50_000', 'limit: 25_000', 'buys on margin'],
        ["'PAPER-7741'", "'PAPER-7742'", 'places a limit buy order via a step'],
        ["'AAPL 187.50'", "'AAPL 188.00'", 'reads the blotter'],
        ["'session opened'", "'session started'", 'shows the positions page'],
      ];
      // signInBeforeEach's hook alone asks for accountId in 'reads the blotter'.
      cases.push(["'PAPER-7741'", "'PAPER-7742'", 'reads the blotter']);
      const unchanged: string[] = [];
      for (const [from, to, title] of cases) {
        if ((await changed(from, to))[title] === before[title]) unchanged.push(`${title}: ${from} -> ${to}`);
      }
      expect(unchanged).toEqual([]);
    });

    it('takes the fixtures of hooks given by member, factory, condition, spread or reassigned name, and use() tuples', async () => {
      const fixtures = `import { test as base } from '@playwright/test';
export const test = base.extend<{ ledger: string; broker: string }>({
  ledger: async ({}, use) => use('NASDAQ'),
  broker: async ({}, use) => use('IBKR'),
});
`;
      const files = {
        'package.json': PLAYWRIGHT_PACKAGE,
        'fixtures/index.ts': fixtures,
        'fixtures/seeds.ts': `export const hooks = {
  seedLedger: async ({ ledger }: { ledger: string }) => {
    void ledger;
  },
};
export function seedFor(symbol: string) {
  return async ({ ledger }: { ledger: string }) => {
    void [symbol, ledger];
  };
}
`,
        'tests/seeds.spec.ts': `import { test } from '../fixtures';
import { hooks, seedFor } from '../fixtures/seeds';

let seed = async ({ page }: { page: unknown }) => {
  void page;
};
if (process.env.LEDGER) {
  seed = async ({ ledger }: { ledger: string }) => {
    void ledger;
  };
}

test.describe('member hook', () => {
  test.beforeEach(hooks.seedLedger);
  test('seeds through a member', async () => {});
});
test.describe('factory hook', () => {
  test.beforeEach(seedFor('AAPL'));
  test('seeds through a factory', async () => {});
});
test.describe('conditional hook', () => {
  test.beforeEach(process.env.REMOTE ? hooks.seedLedger : seed);
  test('seeds remotely or locally', async () => {});
});
test.describe('spread hooks', () => {
  test.beforeEach(...[hooks.seedLedger]);
  test('seeds from a list', async () => {});
});
const VENUE_KEY = 'venue';
const MARGIN_USE = { ledger: async ({ broker }: { broker: string }, use: (value: string) => Promise<void>) => use(broker) };

test.describe('use() from a constant', () => {
  test.use(MARGIN_USE);
  test('uses a constant', async ({ ledger }) => {
    void ledger;
  });
});
test.describe('use() from a factory', () => {
  test.use(seedFor('MSFT') as never);
  test('seeds through a use() factory', async () => {});
});
test.describe('reassigned hook', () => {
  test.beforeEach(seed);
  test('seeds after a reassignment', async () => {});
});
test.describe('tuple use', () => {
  test.use({ ledger: [async ({ broker }, use) => use(broker), { scope: 'test' }], [VENUE_KEY]: 'NASDAQ' });
  test('uses a tuple', async ({ ledger }) => {
    void ledger;
  });
});
`,
      };
      const before = await hashesAfter(files, null);
      const ledger = await hashesAfter(files, ['fixtures/index.ts', fixtures.replace("'NASDAQ'", "'NYSE'")]);
      const broker = await hashesAfter(files, ['fixtures/index.ts', fixtures.replace("'IBKR'", "'SCHWAB'")]);
      const unchanged = [
        ...Object.keys(before).filter((title) => !title.startsWith('uses a') && ledger[title] === before[title]),
        ...['uses a tuple', 'uses a constant'].filter((title) => broker[title] === before[title]),
      ];
      expect(unchanged).toEqual([]);
    });

    it('keeps narrowing past regular expressions, assertions, conditions with values, options and Vitest fixtures', async () => {
      const playwright = `import { test as base } from '@playwright/test';
export const test = base.extend<{ ledger: string; broker: string }>({
  ledger: async ({}, use) => use('NASDAQ'),
  broker: async ({}, use) => use('IBKR'),
});
`;
      const vitest = `import { test as base } from 'vitest';
export const test = base.extend({
  ledger: async ({}, use) => use('NASDAQ'),
  request: async ({ ledger }, use) => use({ ledger }),
  riskLimits: async ({}, use) => use({ maxNotional: 1_000_000 }),
});
`;
      const files = {
        'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.64.1', vitest: '5.0.5' } }),
        'fixtures/index.ts': playwright,
        'fixtures/vitest.ts': vitest,
        'pages/symbol-page.ts': `import assert from 'node:assert';
export class SymbolPage {
  isValidSymbol(symbol: string) {
    if (symbol === '') assert.fail('a symbol is required');
    return /^[A-Z]{1,5}$/.test(symbol);
  }
}
`,
        'tests/ledger.spec.ts': `import { devices } from '@playwright/test';
import { test } from '../fixtures';
import { SymbolPage } from '../pages/symbol-page';

const isCI = Boolean(process.env.CI);
test.use({ ...devices['Pixel 5'], baseURL: process.env.STAGING_URL });
test.skip(isCI, 'runs against a local exchange');

test('shows the ledger venue', async ({ ledger }) => {
  test.expect(new SymbolPage().isValidSymbol(ledger)).toBe(true);
});
`,
        'tests/risk.test.ts': `import { expect } from 'vitest';
import { test } from '../fixtures/vitest';

test('caps the notional', ({ riskLimits }) => {
  expect(riskLimits.maxNotional).toBe(1_000_000);
});
`,
      };
      const root = project(files);
      const scanBoth = async (change: [string, string] | null) => {
        if (change) writeFileSync(path.join(root, change[0]), change[1]);
        const [playwrightScan, vitestScan] = await Promise.all([
          scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' }),
          scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' }),
        ]);
        return [...playwrightScan.tests, ...vitestScan.tests].map((test) => test.dependencyHash);
      };
      const before = await scanBoth(null);
      const broker = await scanBoth(['fixtures/index.ts', playwright.replace("'IBKR'", "'SCHWAB'")]);
      const ledger = await scanBoth(['fixtures/vitest.ts', vitest.replace("'NASDAQ'", "'NYSE'")]);
      expect([broker[0] === before[0], ledger[1] === before[1]]).toEqual([true, true]);
    });
  });
});
