---
description: Run the same declared-state query through the CLI, a complete library script or MCP, and verify the result.
---

# One task, three interfaces

This walkthrough lists tests marked skip, fixme or todo, with their conditions and reasons. It uses the same question
through the CLI, library and MCP. Expected failures are excluded because those tests execute.

You need Node.js 22.12 or newer and a Playwright project with specs in `tests/`. Install `test-inventory` as a dev
dependency, then run commands from that project's root. The CLI and library filters below require core 0.3.0 or
newer. The MCP call uses the current server; [compatibility](/guide/compatibility) explains the separate versions.

## Command line

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --state skip --state fixme --state todo --fields fullName,state,condition,reason --pretty
```

The answer has a `tests` array with the selected fields and each test's `id`, plus summary and diagnostic information.
A matching record from the [trading example](/guide/examples#playwright-end-to-end-tests) includes these keys:

<!-- output: trading-web -->

```json
{
  "fullName": "orders > limit orders > rejects a limit price far from the last trade",
  "state": "fixme",
  "condition": "browserName === 'webkit'",
  "reason": "confirm dialog stays open on WebKit"
}
```

This is a record excerpt, not a complete inventory. The condition is part of the answer: it does not prove the test
was skipped in every browser. An empty `tests` array can mean no matches; check `diagnostics` before concluding that.

## Complete library script

Save the following complete file as `scan-skips.mjs`, or [download it](/examples/scan-skips.mjs). It imports the
installed library and needs no changes to run in the Playwright project described above.

<!-- runnable: scan-skips.mjs -->

```js
import { filterInventory, pickTestFields, scan } from 'test-inventory';

const inventory = await scan({
  root: process.argv[2] ?? '.',
  framework: 'playwright',
  patterns: ['tests/**/*.spec.ts'],
});
const marked = filterInventory(inventory, { states: ['skip', 'fixme', 'todo'] });
const answer = pickTestFields(marked, ['fullName', 'state', 'condition', 'reason']);
console.log(JSON.stringify(answer, null, 2));

if (inventory.diagnostics.some((diagnostic) => diagnostic.level === 'error')) {
  process.stderr.write('The scan has errors; tests may be missing. Inspect diagnostics before using the report.\n');
  process.exitCode = 2;
}
```

```sh
node scan-skips.mjs
```

It prints the same inventory as the CLI query. Unlike the CLI's default policy, this script exits with 2 when the
scan has errors. It still prints the partial result so you can inspect its diagnostics. Neither form executes the
scanned tests. Both write JSON to standard output; `--output` on the CLI writes a file instead.

## MCP

After [connecting the server](/guide/agents), ask your client to call `find_tests` with these arguments:

```text
states: ["skip", "fixme", "todo"]
fields: ["fullName", "state", "condition", "reason"]
limit: 2
```

The arguments are shown as a field list; the [generated MCP reference](https://github.com/Huldoser/test-inventory-mcp/blob/main/docs/tools.md#find_tests)
has complete JSON calls and responses. Follow each non-null `nextCursor` by sending it as `cursor` with the same
other arguments. The small limit makes pagination visible even for a small suite.

Use `get_tests` only when you need additional fields for returned ids. If `scanErrors` is nonzero, call
`scan_diagnostics` before trusting the result. MCP returns records from the same scanner, with its own paging
envelope; it does not return the CLI's complete inventory document.

## Check your conclusion

- The query includes conditional states, so keep `condition` beside the state.
- Expected-to-fail tests are absent because this query did not request that state.
- A successful command or tool call does not establish that the scan is complete.
- A paged answer is complete only when `nextCursor` is null.

For related tests, saved-scan comparisons and scan gaps, use the [task map](/guide/agent-reference#choose-an-interface).
