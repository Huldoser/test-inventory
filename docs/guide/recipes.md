# Query recipes

The output is plain JSON, so any tool that reads JSON can answer questions about a test suite. Each recipe below
answers one question in [jq](https://jqlang.org), [DuckDB](https://duckdb.org) SQL, Node.js and Python, and reads
`inventory.json` from the current folder. The output under each recipe is what all four print for the
[trading-web](/guide/examples#playwright-end-to-end-tests) example project; the test suite runs them on that
project's scan, so they stay correct.

Run a DuckDB query with `duckdb -list -noheader -f query.sql`. DuckDB reads the JSON file as a table with one row;
`unnest(tests)` turns its tests into rows.

## Tests that don't run, and why

Skipped, fixme, todo and expected-to-fail tests, with the reason given in the code.

<!-- recipe: trading-web -->

::: code-group

```sh [jq]
jq -r '.tests[] | select(.state != "active") | "\(.state) \(.relativeFilePath):\(.lineStart) \(.fullName)" + (if .reason then " (\(.reason))" else "" end)' inventory.json
```

```sql [DuckDB]
SELECT t.state || ' ' || t.relativeFilePath || ':' || t.lineStart || ' ' || t.fullName
  || coalesce(' (' || t.reason || ')', '')
FROM (SELECT unnest(tests) AS t FROM 'inventory.json')
WHERE t.state <> 'active'
ORDER BY t.relativeFilePath, t.lineStart;
```

```js [Node.js]
import { readFileSync } from 'node:fs';

const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
for (const test of tests.filter((test) => test.state !== 'active')) {
  const reason = test.reason ? ` (${test.reason})` : '';
  console.log(`${test.state} ${test.relativeFilePath}:${test.lineStart} ${test.fullName}${reason}`);
}
```

```python [Python]
import json

with open("inventory.json", encoding="utf-8") as file:
    inventory = json.load(file)

for test in inventory["tests"]:
    if test["state"] != "active":
        reason = f" ({test['reason']})" if test["reason"] else ""
        print(f"{test['state']} {test['relativeFilePath']}:{test['lineStart']} {test['fullName']}{reason}")
```

:::

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

::: code-group

```sh [jq]
jq -r '.tests[] | select(.state != "active") | ((.comments + [.reason // ""]) | join(" ") | [scan("[A-Z]+-[0-9]+")] | unique[]) as $ticket | "\($ticket) \(.relativeFilePath):\(.lineStart) \(.fullName)"' inventory.json
```

```sql [DuckDB]
SELECT ticket || ' ' || t.relativeFilePath || ':' || t.lineStart || ' ' || t.fullName
FROM (SELECT unnest(tests) AS t FROM 'inventory.json'),
  unnest(list_sort(list_distinct(regexp_extract_all(
    array_to_string(t.comments, ' ') || ' ' || coalesce(t.reason, ''), '[A-Z]+-[0-9]+'
  )))) AS tickets(ticket)
WHERE t.state <> 'active'
ORDER BY t.relativeFilePath, t.lineStart, ticket;
```

```js [Node.js]
import { readFileSync } from 'node:fs';

const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
for (const test of tests.filter((test) => test.state !== 'active')) {
  const text = [...test.comments, test.reason ?? ''].join(' ');
  const tickets = [...new Set(text.match(/[A-Z]+-[0-9]+/g))].sort();
  for (const ticket of tickets) console.log(`${ticket} ${test.relativeFilePath}:${test.lineStart} ${test.fullName}`);
}
```

```python [Python]
import json
import re

with open("inventory.json", encoding="utf-8") as file:
    inventory = json.load(file)

for test in inventory["tests"]:
    if test["state"] != "active":
        text = " ".join(test["comments"] + [test["reason"] or ""])
        for ticket in sorted(set(re.findall(r"[A-Z]+-[0-9]+", text))):
            print(f"{ticket} {test['relativeFilePath']}:{test['lineStart']} {test['fullName']}")
```

:::

```text
TRD-301 tests/login.spec.ts:25 login > asks for a one-time code on a new device
TRD-412 tests/orders/limit-orders.spec.ts:24 orders > limit orders > rejects a limit price far from the last trade
TRD-390 tests/price-stream.spec.ts:6 live price stream > updates prices without a reload
TRD-390 tests/price-stream.spec.ts:12 live price stream > shows a stale badge when the stream disconnects
```

## Smoke tests per file

Tests tagged `@smoke`, counted per file. Tags include those inherited from describes.

<!-- recipe: trading-web -->

::: code-group

```sh [jq]
jq -r '[.tests[] | select(.tags | index("@smoke"))] | group_by(.relativeFilePath)[] | "\(length) \(.[0].relativeFilePath)"' inventory.json
```

```sql [DuckDB]
SELECT count(*) || ' ' || t.relativeFilePath
FROM (SELECT unnest(tests) AS t FROM 'inventory.json')
WHERE list_contains(t.tags, '@smoke')
GROUP BY t.relativeFilePath
ORDER BY t.relativeFilePath;
```

```js [Node.js]
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

```python [Python]
import json
from collections import Counter

with open("inventory.json", encoding="utf-8") as file:
    inventory = json.load(file)

smoke = Counter(test["relativeFilePath"] for test in inventory["tests"] if "@smoke" in test["tags"])
for file, count in sorted(smoke.items()):
    print(f"{count} {file}")
```

:::

```text
4 tests/login.spec.ts
1 tests/orders/limit-orders.spec.ts
3 tests/orders/market-orders.spec.ts
1 tests/portfolio.spec.ts
1 tests/watchlist.spec.ts
```
