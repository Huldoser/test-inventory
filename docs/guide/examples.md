---
description: Scans of a made-up trading app in common setups, from Playwright end-to-end tests to a monorepo, Jest, Mocha, Jasmine, Cypress, WebdriverIO, node:test and Bun.
---

# Examples

Each example below is a small project of a made-up trading app, in a common setup. The projects are in
[`tests/fixtures`](https://github.com/Huldoser/test-inventory/tree/main/tests/fixtures), and the output shown is from
scanning them; the test suite checks that both stay as shown here.

Source blocks are excerpts, with unrelated code and some closing lines omitted; use the linked fixture files for
complete runnable source. JSON blocks show selected record keys, not complete inventories.

| Setup                       | Example                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser end-to-end tests    | [Playwright](#playwright-end-to-end-tests), [Gherkin](#gherkin-features-with-playwright-bdd), [Cypress](#cypress-end-to-end-tests), [WebdriverIO](#webdriverio-end-to-end-tests) |
| Node.js services            | [Vitest](#a-node-js-service), [Jest](#a-jest-service), [Mocha](#a-mocha-service), [Jasmine](#a-jasmine-service), [node:test](#a-node-test-service), [Bun](#a-bun-service)        |
| Components and browser mode | [React](#react-with-testing-library), [Vue](#vue-with-vue-test-utils), [Vitest browser mode](#vitest-browser-mode)                                                               |
| Specialized layouts         | [In-source and type tests](#in-source-and-type-tests), [monorepos](#a-monorepo), [Puppeteer on Jest](#puppeteer-on-jest), [Puppeteer on Mocha](#puppeteer-on-mocha)              |

## Playwright end-to-end tests

`trading-web` tests the trading app's UI with page objects and fixtures. Its specs import `test` from a fixtures file
that extends Playwright's:

<!-- code: trading-web/fixtures/index.ts -->

```ts excerpt
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

The scan follows that import, sees `base.extend()` on Playwright's `test`, and reads the specs that use
it like any other:

<!-- code: trading-web/tests/orders/order-lifecycle.spec.ts -->

```ts excerpt
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

### Gherkin features with playwright-bdd

[playwright-bdd](https://github.com/vitalets/playwright-bdd) generates Playwright tests from `.feature` files. Generate
the files first, then scan them:

```sh
npx bddgen
npx test-inventory ".features-gen/**/*.spec.js" --framework playwright --output inventory.json
```

Records point at the generated files. The generated comments identify their source feature files.

## A Node.js service

`order-service` is an HTTP service that sends orders to a broker, tested with Vitest. Its repository tests need a
database and skip themselves without one:

<!-- code: order-service/tests/repository/orders-repository.test.ts -->

```ts excerpt
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

The project's Vitest config defines the `db` tag with only a description, so the tag changes nothing else about these
tests. A tag the config doesn't define would fail the file, and the scan would report it as `undefined-tag`.

A skip from the test context is read as well, with its condition and note:

<!-- code: order-service/tests/risk/daily-loss-limit.test.ts -->

```ts excerpt
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

```ts excerpt
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

```tsx excerpt
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

```ts excerpt
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
`test.globals: true` in the config the file uses, the outermost one in its folder or a folder above that runs it, or
for
`vitest/globals` in a tsconfig in those folders, and warns with `globals-not-enabled` when there is neither. Here
`vitest.config.ts` turns them on:

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

```ts excerpt
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

The scan reads browser instances from the config and lists their names in each test's `projects`. Each declaration
still has one record, even when the runner executes it in two browsers. This test's record includes:

<!-- output: chart-browser -->

```json
{ "projects": ["chromium", "webkit"] }
```

## In-source and type tests

`strategy-engine` keeps some tests next to the code they test, inside `if (import.meta.vitest)`:

<!-- code: strategy-engine/src/pnl/format.ts -->

```ts excerpt
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

```ts excerpt
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

## A Jest service

`settlement-service` settles trades with a custodian and is tested with Jest, in plain CommonJS. Its config splits the
tests into two projects:

<!-- code: settlement-service/jest.config.js -->

```js excerpt
// jest.config.js
module.exports = {
  testTimeout: 10000,
  projects: [
    { displayName: 'unit', testMatch: ['<rootDir>/src/**/*.test.js', '<rootDir>/src/__tests__/**/*.js'] },
    { displayName: 'integration', testMatch: ['<rootDir>/tests/integration/**/*.test.js'] },
  ],
};
```

The integration tests retry, and tag the file for jest-runner-groups:

<!-- code: settlement-service/tests/integration/custodian.test.js -->

```js excerpt
// tests/integration/custodian.test.js
/**
 * @group integration/custodian
 */
const { settlementDate } = require('../../src/calendar');

jest.retryTimes(2);
// ...
describe('settlement instructions', () => {
  test('sends a delivery-versus-payment instruction', async () => {
    // ...
  }, 30_000);
```

<!-- scan: settlement-service -->

```sh
npx test-inventory "src/**/*.test.js" "src/__tests__/*.js" "tests/**/*.test.js" --framework jest --output inventory.json
```

Without the globs and `--framework`, the scan finds the same files from the config, and Jest from `package.json`.
`jest.retryTimes()` applies to every test of the file, the `@group` is a tag, and the third argument is the timeout:

<!-- output: settlement-service -->

```json
{
  "fullName": "settlement instructions > sends a delivery-versus-payment instruction",
  "projects": ["integration"],
  "tags": ["integration/custodian"],
  "timeout": 30000,
  "timeoutSource": "test",
  "retries": 2,
  "retriesSource": "file"
}
```

A table of objects is one record with its `caseCount`, with the config's `testTimeout`; `--expand-cases` lists each
case, titled as Jest titles it:

<!-- output: settlement-service -->

```json
{
  "fullName": "netting > moves $cash in cash for a $side of $quantity at $price",
  "isParameterized": true,
  "caseCount": 2,
  "projects": ["unit"],
  "timeout": 10000,
  "timeoutSource": "config"
}
```

## Puppeteer on Jest

Puppeteer has no test runner of its own; its end-to-end suites run on Jest through the `jest-puppeteer` preset, which
gives the tests a `page` and `browser`, and `expect(page)` matchers:

<!-- code: trading-e2e-puppeteer/e2e/order-ticket.e2e.js -->

```js excerpt
// e2e/order-ticket.e2e.js
describe('order ticket', () => {
  beforeEach(async () => {
    await page.goto(`${BASE_URL}/trade/AAPL`);
  });
  // ...
  it.each([
    ['0', 'Quantity must be at least 1'],
    ['-5', 'Quantity must be at least 1'],
    ['1000001', 'Quantity is above the 1,000,000 share limit'],
  ])('rejects a quantity of %s', async (quantity, message) => {
```

<!-- scan: trading-e2e-puppeteer -->

```sh
npx test-inventory "e2e/**/*.e2e.js" --framework jest --output inventory.json
```

The preset only sets up the browser, so the scan reads the file as any Jest file, with no warning about it:

<!-- output: trading-e2e-puppeteer -->

```json
{
  "fullName": "order ticket > rejects a quantity of %s",
  "caseCount": 3,
  "tags": ["e2e/order-ticket"],
  "timeout": 30000,
  "timeoutSource": "config"
}
```

## A Mocha service

`fix-gateway` sends orders to venues over FIX and is tested with Mocha, in plain CommonJS. Its config is
`.mocharc.yml`:

<!-- code: fix-gateway/.mocharc.yml -->

```yaml excerpt
# Unit specs and the exchange specs, which share the session helpers in test/helpers.
spec: 'test/**/*.spec.js'
timeout: '5s'
retries: 1
```

The specs set timeouts and retries through Mocha's `this`, in describes and tests written as functions, and skip
themselves at run time:

<!-- code: fix-gateway/test/session.spec.js -->

```js excerpt
// test/session.spec.js
describe('FIX session', () => {
  // ...
  context('heartbeats', function () {
    this.retries(3);
    // ...
    it('answers a test request with a heartbeat', function () {
      this.timeout(250);
      // ...
  describe('logon to a live venue', function () {
    before(function () {
      if (!process.env.FIX_HOST) this.skip();
    });
```

<!-- scan: fix-gateway -->

```sh
npx test-inventory "test/**/*.spec.js" --framework mocha --output inventory.json
```

Without the glob and `--framework`, the scan finds the same files from `.mocharc.yml`, and Mocha from `package.json`.
The test's own timeout wins over the config's `'5s'`, and the retries come from its describe:

<!-- output: fix-gateway -->

```json
{
  "fullName": "FIX session > heartbeats > answers a test request with a heartbeat",
  "timeout": 250,
  "timeoutSource": "test",
  "retries": 3,
  "retriesSource": "suite"
}
```

`this.skip()` in the `before` hook skips the describe's tests when the condition holds:

<!-- output: fix-gateway -->

```json
{
  "fullName": "FIX session > logon to a live venue > logs on with a sequence reset",
  "state": "skip",
  "stateSource": "suite",
  "isConditional": true,
  "condition": "!process.env.FIX_HOST"
}
```

## Puppeteer on Mocha

On Mocha, a Puppeteer suite usually starts the browser in root hooks, which a file in the config's `require` exports
as `mochaHooks`, and keeps the page on the test's context:

<!-- code: trading-e2e-mocha/e2e/order-ticket.e2e.js -->

```js excerpt
// e2e/order-ticket.e2e.js
describe('order ticket', function () {
  beforeEach(async function () {
    await this.page.goto(`${BASE_URL}/trade/AAPL`);
  });
  // ...
  it('shows the order in the blotter', async function () {
    this.timeout(60_000);
```

<!-- scan: trading-e2e-mocha -->

```sh
npx test-inventory "e2e/**/*.e2e.js" --framework mocha --output inventory.json
```

The root hooks aren't counted in `hooks`, but the file that exports them is one of each test's `dependencies`, so
`dependencyHash` changes when it does:

<!-- output: trading-e2e-mocha -->

```json
{
  "fullName": "order ticket > shows the order in the blotter",
  "timeout": 60000,
  "timeoutSource": "test",
  "dependencies": [".mocharc.json", "e2e/browser.js", "e2e/order-ticket.e2e.js"]
}
```

## A Jasmine service

`risk-service` measures exposure and value at risk, and is tested with the jasmine command, in plain CommonJS. Its
config, `spec/support/jasmine.json`, runs `**/*.spec.js` under `spec`, and its `!fixtures/**` leaves the sample
positions out.

Specs mark themselves pending at run time, with a reason, and take a timeout as their third argument:

<!-- code: risk-service/spec/exposure.spec.js -->

```js excerpt
// spec/exposure.spec.js
  it('reads positions from the prime broker', async () => {
    expect(positions.length).toBe(2);
  }, 15_000);
  // ...
  it('includes futures at their notional', () => {
    pending('RISK-81: futures need the contract multiplier');
  });

  it('includes positions in the overnight session', () => {
    if (!process.env.EXTENDED_HOURS) pending('Only with extended hours');
```

<!-- scan: risk-service -->

```sh
npx test-inventory "spec/*.spec.js" "spec/limits/**/*.spec.js" --framework jasmine --output inventory.json
```

Without the globs and `--framework`, the scan finds the same files from `jasmine.json`, and Jasmine from
`package.json`. `pending()` keeps its reason, and under a condition the test is conditional:

<!-- output: risk-service -->

```json
{
  "fullName": "exposure > includes positions in the overnight session",
  "state": "skip",
  "isConditional": true,
  "condition": "!process.env.EXTENDED_HOURS",
  "reason": "Only with extended hours"
}
```

## Cypress end-to-end tests

`trading-ui-cypress` checks order tickets with Cypress. Tests take Cypress's test config before their function:
retries, tags for `@cypress/grep`, and the browsers they run in.

<!-- code: trading-ui-cypress/cypress/e2e/orders/ticket.cy.js -->

```js excerpt
// cypress/e2e/orders/ticket.cy.js
describe('order ticket', { tags: '@orders', retries: { runMode: 2, openMode: 0 } }, () => {
  // ...
  it('accepts an order within the limits', { tags: ['@smoke'] }, () => {
  // ...
  it('opens the ticket from the watchlist', { browser: '!electron' }, () => {
```

<!-- scan: trading-ui-cypress -->

```sh
npx test-inventory "cypress/e2e/**/*.cy.js" --framework cypress --output inventory.json
```

Without the glob and `--framework`, the scan finds the same files from Cypress's default `specPattern`, and Cypress from
`package.json`. A test takes its describe's tags and retries, `runMode` of them, and `browser` is a condition:

<!-- output: trading-ui-cypress -->

```json
{
  "fullName": "order ticket > opens the ticket from the watchlist",
  "state": "skip",
  "isConditional": true,
  "condition": "browser: '!electron'",
  "retries": 2,
  "tags": ["@orders"]
}
```

## WebdriverIO end-to-end tests

`broker-portal` checks a broker's client portal with WebdriverIO on Mocha. A number after a test's function is
WebdriverIO's retry count, and `this.timeout()` sets the describe's timeout over the config's `mochaOpts.timeout`.

<!-- code: broker-portal/test/specs/orders/ticket.e2e.js -->

```js excerpt
// test/specs/orders/ticket.e2e.js
describe('client order ticket', function () {
  this.timeout(90_000);
  // ...
  it('blocks an order above the buying power', async () => {
  // ...
  }, 2);
  // ...
  context('after the close', () => {
    it('queues the order for the open', async function () {
      if (!process.env.AFTER_HOURS) this.skip();
```

<!-- scan: broker-portal -->

```sh
npx test-inventory "test/specs/*.e2e.js" "test/specs/{orders,accounts}/*.e2e.js" --framework webdriverio --output inventory.json
```

Without the globs and `--framework`, the scan finds the files from `wdio.conf.js`, whose `exclude` leaves out the
drafts, and WebdriverIO from `package.json`:

<!-- output: broker-portal -->

```json
{
  "fullName": "client order ticket > blocks an order above the buying power",
  "state": "active",
  "timeout": 90000,
  "retries": 2
}
```

A test that skips itself under a condition keeps the condition:

<!-- output: broker-portal -->

```json
{
  "fullName": "client order ticket > after the close > queues the order for the open",
  "state": "skip",
  "isConditional": true,
  "condition": "!process.env.AFTER_HOURS"
}
```

## A node:test service

`pricing-service` tests a quote service with Node.js's own runner, `node:test`, run by `node --test` from its `test`
script. A test runs subtests with `t.test()`, and a subtest can skip itself.

<!-- code: pricing-service/test/quotes.test.js -->

```js excerpt
// test/quotes.test.js
test('reprices a basket', { timeout: 2_000 }, async (t) => {
  await t.test('reprices equities', () => {
  // ...
  await t.test('reprices bonds', async (bonds) => {
    if (!process.env.BOND_FEED) bonds.skip('no bond feed');
```

<!-- scan: pricing-service -->

```sh
npx test-inventory "test/**/*.js" "src/**/*.test.js" --framework node --output inventory.json
```

Without the globs and `--framework`, the scan finds the same files from Node.js's default patterns, and node:test from
the `test` script. A subtest is listed under its parent's title, with the id of `reprices a basket` in `parentTestId`:

<!-- output: pricing-service -->

```json
{
  "parentTestId": "76080f80b7409d6f",
  "fullName": "reprices a basket > reprices bonds",
  "state": "skip",
  "isConditional": true,
  "condition": "!process.env.BOND_FEED",
  "reason": "no bond feed"
}
```

## A Bun service

`quote-gateway` tests a quote gateway with Bun's `bun test`, using Bun's own chains, as `test.skipIf(condition)`, and
a `bunfig.toml` that runs its routing specs at once.

<!-- code: quote-gateway/bunfig.toml -->

```toml excerpt
[test]
root = "src"
retry = 1
concurrentTestGlob = "**/routing/*.spec.ts"
```

<!-- scan: quote-gateway -->

```sh
npx test-inventory "src/**/*.test.ts" "src/**/*.spec.ts" --framework bun --output inventory.json
```

Without the globs and `--framework`, the scan finds the same files from Bun's patterns under `[test] root`, and Bun from
the `test` script. `skipIf` is a condition, and `[test] retry` applies to every test:

<!-- output: quote-gateway -->

```json
{
  "fullName": "spread > streams quotes from the venue",
  "state": "skip",
  "isConditional": true,
  "condition": "!process.env.VENUE_URL",
  "retries": 1
}
```
