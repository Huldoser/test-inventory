# <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Huldoser/test-inventory/main/docs/public/logo-dark.svg"><img src="https://raw.githubusercontent.com/Huldoser/test-inventory/main/docs/public/logo-light.svg" alt="test-inventory" height="48"></picture>

Test metadata from source code, not from test results.

test-inventory reads Playwright and Vitest test files and lists every test declaration as JSON: its title, file and
lines, the describes around it, its tags and annotations, and whether it is active, skipped, fixme, todo, expected
to fail or in a file the runner refuses to load, with the condition when the state only applies sometimes. It parses
the code and runs nothing, so it needs no browsers, no build and no runner configuration.

Documentation: [huldoser.github.io/test-inventory](https://huldoser.github.io/test-inventory/)

## Install

```sh
npm install --save-dev test-inventory
```

Node.js 22.12 or newer, on Linux, macOS or Windows. Playwright 1.42 or newer, Vitest 3.0 or newer.

## Command line

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
```

Without the glob, the test files are those the Playwright or Vitest configs in the project run.

For this spec from a trading app's UI tests, `tests/alerts.spec.ts`:

<!-- code: trading-web/tests/alerts.spec.ts -->

```ts
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

the first test's record includes:

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

The output also has a `summary` with counts, a record for each describe, and `diagnostics` that point at code the
scan could not read and values it could not work out. Filters such as `--state skip`, `--tag @smoke` and
`--grep "limit order"` keep only some tests, `--fields fullName,reason` keeps only some keys, and `--format jsonl`
writes one record per line.

## Library

```ts
import { scan } from 'test-inventory';

const inventory = await scan({ patterns: ['tests/**/*.test.ts'], framework: 'vitest' });
const todo = inventory.tests.filter((test) => test.isTodo).map((test) => test.fullName);
```

`scanSource()` scans the code of one file without touching the disk. The JSON Schema of the output is exported as
`test-inventory/schema/v1.json`, so a reader can pin the version of the format it understands.

## AI agents

[test-inventory-mcp](https://github.com/Huldoser/test-inventory-mcp) is an MCP server built on test-inventory: agents
in Claude Code, Cursor, VS Code and other MCP clients ask it which tests a project has without running them. The
[AI agents](https://huldoser.github.io/test-inventory/guide/agents) page has the setup and the other ways in.

## Limits

- Config files are read as code, never run, and only in part: settings computed at run time, as from `process.env`,
  can't be worked out, and settings such as `workers` or `use` are not read.
- Values imported from other files are not worked out. A tag or title that comes from an import gets a diagnostic
  that names the module. A custom `test` object is followed through as many files as it takes, through relative
  paths, tsconfig path aliases, `#` imports in package.json and workspace packages; one that can't be followed gets
  an error. Tests declared in helper functions are listed at each call, also for helpers imported from other files.
- A test in a loop or a `.each` table is one record, with `isInLoop` or `caseCount`; the runner creates one test per
  iteration or case.
- Conditions such as `browserName === 'webkit'` are kept as source text, not evaluated.

## Support

If test-inventory is useful to you, [star it on GitHub](https://github.com/Huldoser/test-inventory) or
[sponsor its development](https://github.com/sponsors/Huldoser).

## License

[MIT](LICENSE), copyright © 2026 [Andrey Rychkov](https://github.com/Huldoser).
