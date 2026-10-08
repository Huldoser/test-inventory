# Examples

Each example below is a small project of a made-up trading app, in a common setup. The projects are in
[`tests/fixtures`](https://github.com/Huldoser/test-inventory/tree/main/tests/fixtures), and the output shown is from
scanning them; the test suite checks that both stay as shown here.

## Playwright end-to-end tests

`trading-web` tests the trading app's UI with page objects and fixtures. Its specs import `test` from a fixtures file
that extends Playwright's:

<!-- code: trading-web/fixtures/index.ts -->

```ts
// fixtures/index.ts
export const test = base.extend<TradingFixtures>({
  signedInPage,
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  // ...
});

export { expect } from '@playwright/test';
```

The scan follows that import one file deep, sees `base.extend()` on Playwright's `test`, and reads the specs that use
it like any other:

<!-- code: trading-web/tests/orders/order-lifecycle.spec.ts -->

```ts
// tests/orders/order-lifecycle.spec.ts
import { test, expect } from '../../fixtures/index';

// One order moves through every status, so each step depends on the one before.
test.describe('order lifecycle', { tag: '@orders' }, () => {
  test.describe.configure({ mode: 'serial' });

  test('places a limit order for 100 NVDA', async ({ orderTicket, blotter }) => {
    // ...
  test('shows a partial fill', async ({ blotter }) => {
    await expect(blotter.status('NVDA')).toHaveText(/Partially filled \(\d+\/100\)/);
  });
```

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
```

The describe's record has the mode set by `describe.configure()`, and its tests inherit the mode and the tag:

<!-- output: trading-web -->

```json
{
  "id": "2b2853e11e8f8699",
  "relativeFilePath": "tests/orders/order-lifecycle.spec.ts",
  "lineStart": 4,
  "title": "order lifecycle",
  "isSerial": true,
  "tags": ["@orders"]
}
```

<!-- output: trading-web -->

```json
{
  "fullName": "order lifecycle > shows a partial fill",
  "suiteId": "2b2853e11e8f8699",
  "isSerial": true,
  "tags": ["@orders"]
}
```

## A Node.js service

`order-service` is an HTTP service that sends orders to a broker, tested with Vitest. Its repository tests need a
database and skip themselves without one:

<!-- code: order-service/tests/repository/orders-repository.test.ts -->

```ts
// tests/repository/orders-repository.test.ts
describe.skipIf(!process.env.DATABASE_URL)('orders repository', { tags: ['db'] }, () => {
  // ...
  test('stores an order with its broker id', async () => {
```

<!-- scan: order-service -->

```sh
npx test-inventory "tests/**/*.test.ts" --framework vitest --output inventory.json
```

Each test in the describe gets the describe's condition and tags. `stateSource` and `stateLine` say where the state
comes from:

<!-- output: order-service -->

```json
{
  "fullName": "orders repository > stores an order with its broker id",
  "state": "skip",
  "isConditional": true,
  "condition": "!process.env.DATABASE_URL",
  "stateSource": "suite",
  "stateLine": 5,
  "tags": ["db"]
}
```

The project's Vitest config defines the `db` tag, and a tag in the config can skip tests or change how they run. The
scan does not read the config, and says so:

<!-- output: order-service -->

```json
{
  "code": "config-may-change-state",
  "level": "warning",
  "relativeFilePath": "tests/repository/orders-repository.test.ts",
  "lineStart": 5
}
```

A skip from the test context is read as well, with its condition and note:

<!-- code: order-service/tests/risk/daily-loss-limit.test.ts -->

```ts
// tests/risk/daily-loss-limit.test.ts
  test('resets the loss at the start of the next session', ({ skip }) => {
    skip(process.env.TZ !== 'America/New_York', 'session boundaries are checked in New York time');
```

<!-- output: order-service -->

```json
{
  "fullName": "daily loss limit > resets the loss at the start of the next session",
  "state": "skip",
  "condition": "process.env.TZ !== 'America/New_York'",
  "reason": "session boundaries are checked in New York time",
  "stateSource": "test",
  "stateLine": 14,
  "isParallel": true
}
```

A known bug marked with `test.fails` is `expectedToFail`, and the comment above it is kept:

<!-- code: order-service/tests/broker/fill-events.test.ts -->

```ts
// tests/broker/fill-events.test.ts
  // BUG: TRD-588 fractional partial fills are rounded down to whole shares
  test.fails('keeps the fractional shares of a partial fill', () => {
```

<!-- output: order-service -->

```json
{
  "fullName": "filledShares > keeps the fractional shares of a partial fill",
  "state": "expectedToFail",
  "comments": ["BUG: TRD-588 fractional partial fills are rounded down to whole shares"]
}
```

## React with Testing Library

`trading-dashboard` keeps its tests next to its React components, in `*.test.tsx` files. JSX is read like the rest
of the code:

<!-- code: trading-dashboard/src/components/OrderTicket.test.tsx -->

```tsx
// src/components/OrderTicket.test.tsx
// TODO(TRD-731): the date picker for good-till-date orders is being rebuilt
it.skip('submits a good-till-date order', async () => {
  const user = userEvent.setup();
  render(<OrderTicket symbol="AAPL" lastPrice={187.5} buyingPower={25_000} onSubmit={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Good till date' }));
});

it.todo('shows the estimated commission');
```

<!-- scan: trading-dashboard -->

```sh
npx test-inventory "src/**/*.test.tsx" --framework vitest --output inventory.json
```

<!-- output: trading-dashboard -->

```json
{
  "fullName": "OrderTicket > submits a good-till-date order",
  "relativeFilePath": "src/components/OrderTicket.test.tsx",
  "state": "skip",
  "comments": ["TODO(TRD-731): the date picker for good-till-date orders is being rebuilt"]
}
```

<!-- output: trading-dashboard -->

```json
{
  "fullName": "OrderTicket > shows the estimated commission",
  "state": "todo",
  "bodyHash": null
}
```

## Vue with Vue Test Utils

`watchlist-vue` turns on Vitest's globals, so its specs use `describe` and `it` without importing them:

<!-- code: watchlist-vue/tests/unit/Watchlist.spec.ts -->

```ts
// tests/unit/Watchlist.spec.ts
import { mount } from '@vue/test-utils';
import Watchlist from '../../src/components/Watchlist.vue';
// ...
describe('when the feed is delayed', () => {
  it('shows how many minutes the quotes are delayed', () => {
    const wrapper = mount(Watchlist, { props: { quotes, delayedMinutes: 15 } });
    expect(wrapper.get('[data-test="delay-banner"]').text()).toBe('Quotes are delayed by 15 minutes');
  });

  it.todo('greys out quotes older than the delay');
});
```

<!-- scan: watchlist-vue -->

```sh
npx test-inventory "tests/unit/**/*.spec.ts" --framework vitest --output inventory.json
```

A name that a file uses but never imports or declares is read as a Vitest global. The scan then looks for
`globals: true` in a Vitest or Vite config, or `vitest/globals` in a tsconfig, in the file's folder and the folders
above it, and warns with `globals-not-enabled` when there is none. Here `vitest.config.ts` turns them on:

<!-- output: watchlist-vue -->

```json
{
  "fullName": "Watchlist > when the feed is delayed > greys out quotes older than the delay",
  "suitePath": ["Watchlist", "when the feed is delayed"],
  "state": "todo"
}
```

## Vitest browser mode

`chart-browser` draws candlestick charts on a canvas and tests them in Chromium and WebKit with Vitest's browser
mode. One test is skipped in WebKit:

<!-- code: chart-browser/src/candlestick-chart.test.ts -->

```ts
// src/candlestick-chart.test.ts
  // WebKit returns an empty blob for canvases larger than the device pixel ratio allows in headless mode.
  test.skipIf(server.browser === 'webkit')('exports the chart as a PNG', async () => {
```

<!-- scan: chart-browser -->

```sh
npx test-inventory "src/**/*.test.ts" --framework vitest --output inventory.json
```

<!-- output: chart-browser -->

```json
{
  "fullName": "CandlestickChart > exports the chart as a PNG",
  "state": "skip",
  "isConditional": true,
  "condition": "server.browser === 'webkit'",
  "stateSource": "test"
}
```

Browser instances come from the config, which is not read, so each test is one record. The runner runs it once per
browser.

## In-source and type tests

`strategy-engine` keeps some tests next to the code they test, inside `if (import.meta.vitest)`:

<!-- code: strategy-engine/src/pnl/format.ts -->

```ts
// src/pnl/format.ts
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('formatPnl', () => {
    it('adds a plus sign to gains', () => {
      expect(formatPnl(1234.5)).toBe('+$1,234.50');
    });
```

It also has type tests in `*.test-d.ts` files:

<!-- code: strategy-engine/tests/orders/order.test-d.ts -->

```ts
// tests/orders/order.test-d.ts
describe('Order', () => {
  test('narrows to a limit order by its type', () => {
    const order = { symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 10, limitPrice: 187.5 } as Order;
    if (order.type === 'limit') expectTypeOf(order).toEqualTypeOf<LimitOrder>();
  });
```

Scan the source files and the type test files along with the tests:

<!-- scan: strategy-engine -->

```sh
npx test-inventory "tests/**/*.{test,test-d}.ts" "src/**/*.ts" --framework vitest --output inventory.json
```

The `import.meta.vitest` check is how in-source tests are written, so it does not count as a condition:

<!-- output: strategy-engine -->

```json
{
  "fullName": "formatPnl > adds a plus sign to gains",
  "relativeFilePath": "src/pnl/format.ts",
  "lineStart": 16,
  "state": "active",
  "isInCondition": false
}
```

<!-- output: strategy-engine -->

```json
{
  "fullName": "Order > narrows to a limit order by its type",
  "relativeFilePath": "tests/orders/order.test-d.ts",
  "isTypeTest": true
}
```

## A monorepo

`trading-monorepo` has three packages, each with its own Vitest config, and a root config that lists them as
projects. Scan them all from the root:

<!-- scan: trading-monorepo -->

```sh
npx test-inventory "packages/*/src/**/*.test.ts" --framework vitest --output inventory.json
```

Paths are relative to the root, so each record names its package:

<!-- output: trading-monorepo -->

```json
{
  "fullName": "QuoteCache > returns the mid price of a fresh quote",
  "relativeFilePath": "packages/market-data/src/quote-cache.test.ts"
}
```

Only `market-data` turns on globals, in `packages/market-data/vitest.config.ts`. The scan finds that config from the
package's test files, so it gives no `globals-not-enabled` warning:

<!-- output: trading-monorepo -->

```json
{
  "fileCount": 3,
  "suiteCount": 3,
  "testCount": 8,
  "activeCount": 7,
  "todoCount": 1,
  "diagnosticCount": 0
}
```

To scan one package, pass it as the root: `--root packages/risk`. The framework version is read from
`node_modules` in the root or a folder above it, so a package of a monorepo gets the version installed at the top.
