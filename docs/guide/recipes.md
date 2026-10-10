# Query recipes

The output is plain JSON, so any language can answer questions about a test suite. Each recipe below is a Node.js
script that answers one question. It reads `inventory.json` from the current folder: save it as a `.mjs` file and run
it with `node`. The output under each recipe is what it prints for the
[trading-web](/guide/examples#playwright-end-to-end-tests) example project; the test suite runs the recipes on that
project's scan, so they stay correct.

## Tests that don't run, and why

Skipped, fixme, todo and expected-to-fail tests, with the reason given in the code.

<!-- recipe: trading-web -->

```js
import { readFileSync } from 'node:fs';

const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
for (const test of tests.filter((test) => test.state !== 'active')) {
  const reason = test.reason ? ` (${test.reason})` : '';
  console.log(`${test.state} ${test.relativeFilePath}:${test.lineStart} ${test.fullName}${reason}`);
}
```

```text
skip tests/alerts.spec.ts:11 price alerts > notifies when the price crosses above the alert (Alerts only trigger while the market is open)
skip tests/alerts.spec.ts:16 price alerts > does not notify for a price that was never reached (Alerts only trigger while the market is open)
skip tests/alerts.spec.ts:21 price alerts > deletes an alert (Alerts only trigger while the market is open)
expectedToFail tests/backtest.spec.ts:20 backtests > exports trades to CSV
fixme tests/login.spec.ts:25 login > asks for a one-time code on a new device
fixme tests/orders/limit-orders.spec.ts:24 orders > limit orders > rejects a limit price far from the last trade (confirm dialog stays open on WebKit)
fixme tests/price-stream.spec.ts:6 live price stream > updates prices without a reload (The WebSocket reconnects in a loop on WebKit (TRD-390))
fixme tests/price-stream.spec.ts:12 live price stream > shows a stale badge when the stream disconnects (The WebSocket reconnects in a loop on WebKit (TRD-390))
```

## Tickets mentioned by tests that don't run

Ticket numbers such as `TRD-412` in the comments above a test or in its reason. Use it to check that every disabled test has a ticket, or to list the tests a ticket blocks.

<!-- recipe: trading-web -->

```js
import { readFileSync } from 'node:fs';

const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
for (const test of tests.filter((test) => test.state !== 'active')) {
  const text = [...test.comments, test.reason ?? ''].join(' ');
  const tickets = [...new Set(text.match(/[A-Z]+-[0-9]+/g))].sort();
  for (const ticket of tickets) console.log(`${ticket} ${test.relativeFilePath}:${test.lineStart} ${test.fullName}`);
}
```

```text
TRD-301 tests/login.spec.ts:25 login > asks for a one-time code on a new device
TRD-412 tests/orders/limit-orders.spec.ts:24 orders > limit orders > rejects a limit price far from the last trade
TRD-390 tests/price-stream.spec.ts:6 live price stream > updates prices without a reload
TRD-390 tests/price-stream.spec.ts:12 live price stream > shows a stale badge when the stream disconnects
```

## Smoke tests per file

Tests tagged `@smoke`, counted per file. Tags include those inherited from describes.

<!-- recipe: trading-web -->

```js
import { readFileSync } from 'node:fs';

const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
const perFile = Map.groupBy(
  tests.filter((test) => test.tags.includes('@smoke')),
  (test) => test.relativeFilePath,
);
for (const [file, smoke] of [...perFile].sort(([a], [b]) => (a < b ? -1 : 1))) {
  console.log(`${smoke.length} ${file}`);
}
```

```text
4 tests/login.spec.ts
1 tests/orders/limit-orders.spec.ts
3 tests/orders/market-orders.spec.ts
1 tests/portfolio.spec.ts
1 tests/watchlist.spec.ts
```

---

If these recipes save you time, consider [sponsoring test-inventory](https://github.com/sponsors/Huldoser). A query you
miss here is welcome as an [issue](https://github.com/Huldoser/test-inventory/issues).
