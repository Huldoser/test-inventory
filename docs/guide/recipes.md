---
description: Query declared skip states, conditions, reasons, related tests and tags in a saved scan.
---

# Query recipes

The output is plain JSON, so any language can answer questions about a test suite. Each recipe below is a Node.js
script that answers one question. It reads `inventory.json` from the current folder: save it as a `.mjs` file and run
it with `node`. The output under each recipe is what it prints for the
[trading-web](/guide/examples#playwright-end-to-end-tests) example project; the test suite runs the recipes on that
project's scan, so they stay correct.

## Tests marked skip, fixme or todo {#tests-that-don-t-run-and-why}

List declared skip, fixme and todo states with their conditions and reasons. A conditional skip is not proof that a
test was skipped in a run. Expected-to-fail tests run, so they are excluded from this query.

For a quick query without a script, pass `--state skip --state fixme --state todo` to the CLI. The script below also
shows each condition. [Key concepts](/guide/concepts#state-describes-the-code) explains the state model.

<!-- recipe: trading-web -->

```js
import { readFileSync } from 'node:fs';

const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
for (const test of tests.filter((test) => ['skip', 'fixme', 'todo'].includes(test.state))) {
  const reason = test.reason ? ` (${test.reason})` : '';
  const condition = test.isConditional ? ` [when ${test.condition}]` : '';
  console.log(`${test.state} ${test.relativeFilePath}:${test.lineStart} ${test.fullName}${reason}${condition}`);
}
```

```text
skip tests/alerts.spec.ts:11 price alerts > notifies when the price crosses above the alert (Alerts only trigger while the market is open) [when isMarketClosed()]
skip tests/alerts.spec.ts:16 price alerts > does not notify for a price that was never reached (Alerts only trigger while the market is open) [when isMarketClosed()]
skip tests/alerts.spec.ts:21 price alerts > deletes an alert (Alerts only trigger while the market is open) [when isMarketClosed()]
fixme tests/login.spec.ts:25 login > asks for a one-time code on a new device
fixme tests/orders/limit-orders.spec.ts:24 orders > limit orders > rejects a limit price far from the last trade (confirm dialog stays open on WebKit) [when browserName === 'webkit']
fixme tests/price-stream.spec.ts:8 live price stream > updates prices without a reload (The WebSocket reconnects in a loop on WebKit (TRD-390)) [when browserName === 'webkit']
fixme tests/price-stream.spec.ts:14 live price stream > shows a stale badge when the stream disconnects (The WebSocket reconnects in a loop on WebKit (TRD-390)) [when browserName === 'webkit']
```

## Tests a change can affect

The tests whose code, fixtures, test data, config or snapshots include a changed file, and those that reach code the
scan can't follow. The CLI's `--related` gives the same tests; this shows them by file.

<!-- recipe: trading-web -->

```js
import { readFileSync } from 'node:fs';

const changed = new Set(['pages/orders-blotter.ts', 'test-data/tags.ts']);
const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
for (const test of tests) {
  const reasons = test.dependencies.filter((file) => changed.has(file));
  if (test.hasUnfollowedDependencies) reasons.push('code the scan cannot follow');
  if (reasons.length > 0)
    console.log(`${test.relativeFilePath}:${test.lineStart} ${test.fullName} (${reasons.join(', ')})`);
}
```

```text
tests/orders/limit-orders.spec.ts:10 orders > limit orders > places a limit buy order for AAPL @smoke (pages/orders-blotter.ts)
tests/orders/limit-orders.spec.ts:16 orders > limit orders > cancels an open limit order (pages/orders-blotter.ts, test-data/tags.ts)
tests/orders/market-orders.spec.ts:8 market orders > fills a market buy order (pages/orders-blotter.ts)
tests/orders/market-orders.spec.ts:14 market orders > fills a market sell order (pages/orders-blotter.ts)
tests/orders/order-lifecycle.spec.ts:7 order lifecycle > places a limit order for 100 NVDA (pages/orders-blotter.ts)
tests/orders/order-lifecycle.spec.ts:18 order lifecycle > shows a partial fill (pages/orders-blotter.ts)
tests/orders/order-lifecycle.spec.ts:22 order lifecycle > cancels the remaining quantity (pages/orders-blotter.ts)
tests/portfolio.spec.ts:18 portfolio > closes a position from the positions table (pages/orders-blotter.ts)
```

## Tickets mentioned by tests marked skip, fixme or todo {#tickets-mentioned-by-tests-that-don-t-run}

Find ticket numbers such as `TRD-412` in the comments above a test or in its reason. Use this to review why tests have
skip, fixme or todo states, including conditional ones, or to list the tests a ticket references.

<!-- recipe: trading-web -->

```js
import { readFileSync } from 'node:fs';

const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
for (const test of tests.filter((test) => ['skip', 'fixme', 'todo'].includes(test.state))) {
  const text = [...test.comments, test.reason ?? ''].join(' ');
  const tickets = [...new Set(text.match(/[A-Z]+-[0-9]+/g))].sort();
  for (const ticket of tickets) console.log(`${ticket} ${test.relativeFilePath}:${test.lineStart} ${test.fullName}`);
}
```

```text
TRD-301 tests/login.spec.ts:25 login > asks for a one-time code on a new device
TRD-412 tests/orders/limit-orders.spec.ts:24 orders > limit orders > rejects a limit price far from the last trade
TRD-390 tests/price-stream.spec.ts:8 live price stream > updates prices without a reload
TRD-390 tests/price-stream.spec.ts:14 live price stream > shows a stale badge when the stream disconnects
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

A query you miss here is welcome as an [issue](https://github.com/Huldoser/test-inventory/issues).
