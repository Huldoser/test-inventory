# <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Huldoser/test-inventory/main/docs/public/logo-dark.svg"><img src="https://raw.githubusercontent.com/Huldoser/test-inventory/main/docs/public/logo-light.svg" alt="test-inventory" height="48"></picture>

Find skipped tests, catch pull requests that weaken your test suite, and get the runner commands for tests a git diff can affect, without running the suite.

test-inventory parses Playwright, Vitest, Jest, Mocha, Jasmine, Cypress, WebdriverIO, node:test and Bun test files and configs from source. It needs no browsers, no build and no runner setup. CI checks the output against all 9 runners and scans 24 public repositories (69,127 tests across 7,095 files) on every pull request with zero parse errors: see [real projects](https://huldoser.github.io/test-inventory/guide/real-projects) and [runner comparisons](https://huldoser.github.io/test-inventory/guide/runners).

Documentation: [huldoser.github.io/test-inventory](https://huldoser.github.io/test-inventory/) · [Framework guides](https://huldoser.github.io/test-inventory/frameworks/)

## Three ways to use it

| Tool                                                                                           | Best for                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **CLI and library** (`test-inventory`)                                                         | Audit skipped tests, get runner commands for a git diff, compare saved scans, or read test metadata as JSON. |
| **GitHub Action** ([test-inventory-action](https://github.com/Huldoser/test-inventory-action)) | Comment on pull requests when tests won't run, get turned off, are removed, or lose their assertions.        |
| **MCP server** ([test-inventory-mcp](https://github.com/Huldoser/test-inventory-mcp))          | Let Claude Code, Cursor, VS Code and other AI clients query tests and get run commands without running them. |

## Try it in 5 seconds

Run directly in any JavaScript or TypeScript project with Node.js 22.12 or newer. No install needed, and the scanner detects the runner and reads its config automatically.

List skipped and fixme tests with their conditions and reasons:

```sh
npx test-inventory --state skip --state fixme --fields fullName,state,condition,reason --pretty
```

Print the exact runner command for tests affected by your current branch:

```sh
git diff --name-only origin/main... | npx test-inventory --related - --format commands
```

```text
npx playwright test tests/orders/limit-orders.spec.ts tests/orders/market-orders.spec.ts tests/orders/order-lifecycle.spec.ts tests/portfolio.spec.ts --config playwright.config.ts --project chromium webkit
```

Compare two saved scans to track additions, removals, renames, moves and newly skipped tests:

```sh
npx test-inventory diff base.json head.json --format markdown
```

In a project with several runners, pass `--framework <name>`. Pass quoted globs to select specific files instead of reading runner configs, or see your [framework guide](https://huldoser.github.io/test-inventory/frameworks/).

## Pull request comments (GitHub Action)

[Test changes by test-inventory](https://github.com/marketplace/actions/test-changes-by-test-inventory) compares a pull request's base and head from source and comments when tests need a look before merging. It needs no project install, works on pull requests from forks and never fails a check.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Huldoser/test-inventory-action/main/docs/comment-dark.png">
  <img alt="Pull request comment showing 5 tests that need a look: 2 won't run, 1 is turned off, 1 was removed and 1 has no assertions left, each linked to its line" src="https://raw.githubusercontent.com/Huldoser/test-inventory-action/main/docs/comment-light.png" width="820">
</picture>

Setup uses two short workflows in [test-inventory-action](https://github.com/Huldoser/test-inventory-action#usage).

## What the JSON looks like

For this spec from a trading app's UI tests, `tests/alerts.spec.ts`:

<!-- code: trading-web/tests/alerts.spec.ts -->

```ts excerpt
import { test, expect } from '../fixtures/index';
import { isMarketClosed } from '../test-data/market-hours';

test.describe('price alerts', () => {
  test.skip(isMarketClosed(), 'Alerts only trigger while the market is open');

  test.beforeEach(async ({ alertsPage }) => {
    await alertsPage.goTo();
  });

  test('notifies when the price crosses above the alert', async ({ alertsPage }) => {
    await alertsPage.create('AAPL', 'above', 1);
    await expect(alertsPage.notifications).toContainText('AAPL is above $1.00');
  });

  // ...
});
```

Running a scan:

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
```

produces a deterministic record for each test, including:

<!-- output: trading-web -->

```json
{
  "id": "006bcf2289191aef",
  "relativeFilePath": "tests/alerts.spec.ts",
  "lineStart": 11,
  "lineEnd": 14,
  "fullName": "price alerts > notifies when the price crosses above the alert",
  "state": "skip",
  "isConditional": true,
  "condition": "isMarketClosed()",
  "reason": "Alerts only trigger while the market is open",
  "stateSource": "suite",
  "tags": []
}
```

Each scan also includes `summary` counts, `suites`, `configs`, `files` and `diagnostics`. Ids stay stable when tests move lines, and `bodyHash` / `dependencyHash` support [inventory diffs](https://huldoser.github.io/test-inventory/guide/diff) and `--related` filtering. Use `--state`, `--tag`, `--grep`, `--fields` and `--format jsonl` or `--format commands` to narrow the output; see the [CLI reference](https://huldoser.github.io/test-inventory/guide/cli).

## Install and library

For CI, scripts or programmatic use, install as a dev dependency:

```sh
npm install --save-dev test-inventory
```

```ts
import { filterInventory, runCommands, scan } from 'test-inventory';

const inventory = await scan({ patterns: ['tests/**/*.test.ts'], framework: 'vitest' });
const todo = inventory.tests.filter((test) => test.isTodo).map((test) => test.fullName);
const commands = runCommands(filterInventory(inventory, { related: ['src/orders/pricing.ts'] }));
```

`scanSource()` scans one file in memory without reading from disk, and `diffInventories()` compares two saved scans. JSON Schemas are exported as `test-inventory/schema/v1.json` and `test-inventory/schema/diff-v1.json`.

**Requirements:** Node.js 22.12 or newer on Linux, macOS or Windows. Supports Playwright 1.31+, Vitest 1.0+, Jest 27.0+, Mocha 10.0+, Jasmine 3.0+, Cypress 10.0+, WebdriverIO 7.0+, node:test 22.0+ and Bun 1.2.23+.

## AI agents (MCP)

[test-inventory-mcp](https://github.com/Huldoser/test-inventory-mcp) gives coding agents structured tools to summarize tests, inspect skip reasons and get run commands for changed files.

In Claude Code, from your project folder:

```sh
claude mcp add --scope project test-inventory -- npx -y test-inventory-mcp@latest
```

Setup for Cursor, VS Code and other clients is in [test-inventory-mcp](https://github.com/Huldoser/test-inventory-mcp#setup) and the [AI agents guide](https://huldoser.github.io/test-inventory/guide/agents).

## Limits

- **Static declarations, not execution results:** the scanner reads code and configs without running them, so runtime conditions like `browserName === 'webkit'` are kept as source text and runtime-computed configs can leave values unknown.
- **Project imports only:** local files, tsconfig/config aliases, `#` imports and workspace packages are followed; installed packages in `node_modules` are not.
- **Declarations by default:** loops and `.each` tables are one record with `caseCount` unless you pass `--expand-cases`.
- **Check `diagnostics`:** errors indicate parse failures, unresolved imports or unreadable config settings where tests may be missing. See [known limits](https://huldoser.github.io/test-inventory/guide/limits).

## Support

If test-inventory is useful to you, [star it on GitHub](https://github.com/Huldoser/test-inventory) or
[sponsor its development](https://github.com/sponsors/Huldoser).

## License

[MIT](LICENSE), copyright © 2026 [Andrey Rychkov](https://github.com/Huldoser).
