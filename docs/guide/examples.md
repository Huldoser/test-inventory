---
description: Scans of a made-up trading app in common setups, from Playwright end-to-end tests to a monorepo, Jest, Mocha, Jasmine, Cypress, WebdriverIO, node:test and Bun.
---

# Examples

This page collects examples for **all frameworks**. Choose a [framework guide](/frameworks/) for a focused
walkthrough, its syntax and its limitations.

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

The framework guides also show [Cypress component and E2E selection](/frameworks/cypress#cypress-component-and-end-to-end-tests),
[WebdriverIO with Jasmine](/frameworks/webdriverio#webdriverio-with-jasmine),
[Playwright project counts](/frameworks/playwright#playwright-projects-and-declaration-counts) and
[Bun case expansion](/frameworks/bun#bun-parameterized-tests).

## Playwright end-to-end tests

<!-- #region example-playwright -->

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

<!-- #endregion example-playwright -->

## Playwright projects and declaration counts

<!-- #region example-playwright-projects -->

`trading-web` runs the same tests in Chromium and WebKit. Its config defines two projects:

<!-- code: trading-web/playwright.config.ts -->

```ts excerpt
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // ...
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

Scan its declarations once:

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --pretty
```

The output contains one record for this test, with both project names. This is an excerpt of that record:

<!-- output: trading-web -->

```json
{
  "fullName": "order lifecycle > shows a partial fill",
  "projects": ["chromium", "webkit"]
}
```

Running the test in two browsers does not double the inventory's `testCount`. The inventory counts source
declarations; a runner report can contain a separate result for each project. A test's `projects` lists the
projects whose file-selection settings include it. Read [project configuration](/frameworks/playwright#configuration-and-limits)
for the settings the scanner can resolve.

<!-- #endregion example-playwright-projects -->

## A Node.js service with Vitest {#a-node-js-service}

<!-- #region example-vitest -->

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

<!-- #endregion example-vitest -->

## React with Vitest and Testing Library {#react-with-testing-library}

<!-- #region example-vitest-react -->

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

<!-- #endregion example-vitest-react -->

## Vue with Vitest and Vue Test Utils {#vue-with-vue-test-utils}

<!-- #region example-vitest-vue -->

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

<!-- #endregion example-vitest-vue -->

## Vitest browser mode

<!-- #region example-vitest-browser -->

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

<!-- #endregion example-vitest-browser -->

## In-source and type tests

<!-- #region example-vitest-in-source -->

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

<!-- #endregion example-vitest-in-source -->

## A Vitest monorepo {#a-monorepo}

<!-- #region example-vitest-monorepo -->

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

<!-- #endregion example-vitest-monorepo -->

## A Jest service

<!-- #region example-jest -->

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

<!-- #endregion example-jest -->

## Puppeteer on Jest

<!-- #region example-jest-puppeteer -->

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

<!-- #endregion example-jest-puppeteer -->

## A Mocha service

<!-- #region example-mocha -->

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

<!-- #endregion example-mocha -->

## Puppeteer on Mocha

<!-- #region example-mocha-puppeteer -->

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

<!-- #endregion example-mocha-puppeteer -->

## A Jasmine service

<!-- #region example-jasmine -->

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

<!-- #endregion example-jasmine -->

## Cypress end-to-end tests

<!-- #region example-cypress -->

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

<!-- #endregion example-cypress -->

## Cypress component and end-to-end tests

<!-- #region example-cypress-component -->

`trading-components-cypress` models a project with E2E specs in `cypress/e2e/` and React component specs next to
components in `src/`. Its config gives each testing type its own file pattern and support file:

<!-- code: trading-components-cypress/cypress.config.js -->

```js
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  retries: { runMode: 1, openMode: 0 },
  e2e: {
    baseUrl: 'http://localhost:4173',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
  },
  component: {
    devServer: { framework: 'react', bundler: 'vite' },
    specPattern: 'src/**/*.cy.tsx',
    supportFile: 'cypress/support/component.js',
  },
});
```

The component spec imports a component from the same folder:

<!-- code: trading-components-cypress/src/OrderTicket.cy.tsx -->

```tsx excerpt
// src/OrderTicket.cy.tsx
import { mount } from 'cypress/react';
import { OrderTicket } from './OrderTicket';

// ...
it('blocks orders without buying power', () => {
  mount(<OrderTicket symbol="AAPL" buyingPower={0} />);
  cy.contains('button', 'Buy AAPL').should('be.disabled');
});
```

Scan both sets of files from the project root:

<!-- scan: trading-components-cypress -->

```sh
npx test-inventory "cypress/e2e/**/*.cy.js" "src/**/*.cy.tsx" --framework cypress --pretty
```

Omitting the globs finds the same files from this config. These are excerpts of two output records:

<!-- output: trading-components-cypress -->

```json
{
  "fullName": "order entry > opens the order ticket from the watchlist",
  "relativeFilePath": "cypress/e2e/orders.cy.js",
  "projects": ["e2e"]
}
```

<!-- output: trading-components-cypress -->

```json
{
  "fullName": "OrderTicket > blocks orders without buying power",
  "relativeFilePath": "src/OrderTicket.cy.tsx",
  "projects": ["component"],
  "dependencies": [
    "cypress.config.js",
    "cypress/support/component.js",
    "cypress/support/e2e.js",
    "src/OrderTicket.cy.tsx",
    "src/OrderTicket.tsx"
  ]
}
```

The scan includes both configured support files in dependency hashes; it does not execute them, start the dev
server or mount the component. `projects` identifies the testing type. Explicit globs do not override its
`specPattern`: a selected file outside both patterns can appear with `projects: []` and state `not-loaded`.
Use your project's patterns when adapting the command.

<!-- #endregion example-cypress-component -->

## WebdriverIO end-to-end tests

<!-- #region example-webdriverio -->

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

<!-- #endregion example-webdriverio -->

## WebdriverIO with Jasmine

<!-- #region example-webdriverio-jasmine -->

`broker-portal-jasmine` models a WebdriverIO project using the Jasmine adapter. Its config selects Jasmine and
sets the default spec timeout:

<!-- code: broker-portal-jasmine/wdio.conf.js -->

```js
export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.e2e.js'],
  baseUrl: 'http://localhost:4173',
  capabilities: [{ browserName: 'chrome' }],
  framework: 'jasmine',
  jasmineOpts: { defaultTimeoutInterval: 45000 },
};
```

A spec can override that timeout with its third argument. This spec also marks itself pending under a condition:

<!-- code: broker-portal-jasmine/test/specs/statements.e2e.js -->

```js excerpt
// test/specs/statements.e2e.js
it('offers archived statements', async () => {
  if (!process.env.ARCHIVE_ENABLED) pending('Archived statements require archive access');
  await browser.url('/statements/archive');
  await expect($('[data-test="archive-download"]')).toBeEnabled();
}, 15000);
```

Keep `--framework webdriverio`; the `framework` setting in `wdio.conf.js` selects Jasmine's syntax:

<!-- scan: broker-portal-jasmine -->

```sh
npx test-inventory "test/specs/**/*.e2e.js" --framework webdriverio --pretty
```

Omitting the glob finds the same files from `specs`. These record excerpts show the config timeout and the
spec's override:

<!-- output: broker-portal-jasmine -->

```json
{
  "fullName": "statement downloads > offers the latest monthly statement",
  "timeout": 45000,
  "timeoutSource": "config"
}
```

<!-- output: broker-portal-jasmine -->

```json
{
  "fullName": "statement downloads > offers archived statements",
  "state": "skip",
  "isConditional": true,
  "condition": "!process.env.ARCHIVE_ENABLED",
  "reason": "Archived statements require archive access",
  "timeout": 15000,
  "timeoutSource": "test"
}
```

The conditional `pending()` keeps its reason; the scanner does not evaluate the environment variable or run the
spec. Use [WebdriverIO's supported syntax](/frameworks/webdriverio#supported-syntax) for adapter-specific behavior.

<!-- #endregion example-webdriverio-jasmine -->

## A node:test service

<!-- #region example-node -->

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

<!-- #endregion example-node -->

## A Bun service

<!-- #region example-bun -->

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

<!-- #endregion example-bun -->

## Bun parameterized tests

<!-- #region example-bun-cases -->

`quote-gateway` tests the same spread calculation with two rows of data:

<!-- code: quote-gateway/src/quotes/spread.test.ts -->

```ts excerpt
// src/quotes/spread.test.ts
test.each([
  { mic: 'XNAS', bid: 99.95, ask: 100.05 },
  { mic: 'XLON', bid: 49.9, ask: 50.1 },
])('quotes the $mic spread', ({ bid, ask }) => {
  expect(spreadBps({ bid, ask })).toBeGreaterThan(0);
});
```

First scan the declarations:

<!-- scan: quote-gateway -->

```sh
npx test-inventory "src/**/*.test.ts" "src/**/*.spec.ts" --framework bun --pretty
```

The table is one record with two cases. This is an excerpt:

<!-- output: quote-gateway -->

```json
{
  "fullName": "spread > quotes the $mic spread",
  "caseCount": 2,
  "caseIndex": null
}
```

To list each resolvable case separately, add `--expand-cases` to the same scan:

<!-- scan: quote-gateway -->

```sh
npx test-inventory "src/**/*.test.ts" "src/**/*.spec.ts" --framework bun --expand-cases --pretty
```

The table becomes two records with their substituted titles and zero-based indexes. These are record excerpts:

<!-- output: quote-gateway --expand-cases -->

```json
{
  "fullName": "spread > quotes the XNAS spread",
  "caseCount": 1,
  "caseIndex": 0
}
```

<!-- output: quote-gateway --expand-cases -->

```json
{
  "fullName": "spread > quotes the XLON spread",
  "caseCount": 1,
  "caseIndex": 1
}
```

Expansion follows the detected Bun version's title rules. If your project does not record its Bun version,
pass `--framework-version` with the version you use to both commands.
Unresolved data stays one record with a `cases-not-expanded` warning. See [Bun's table syntax](/frameworks/bun#supported-syntax)
for the supported title formats. The scanner reads the table without running Bun or executing either test case.

<!-- #endregion example-bun-cases -->
