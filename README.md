# test-inventory

Test metadata from source code, not from test results.

test-inventory reads Playwright and Vitest test files and lists every test declaration as JSON: its title, file and
lines, the describes around it, its tags and annotations, and whether it is active, skipped, fixme, todo, expected
to fail or in a file Playwright refuses to load, with the condition when the state only applies sometimes. It parses
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
scan could not read and values it could not work out.

## Library

```ts
import { scan } from 'test-inventory';

const inventory = await scan({ patterns: ['tests/**/*.test.ts'], framework: 'vitest' });
const todo = inventory.tests.filter((test) => test.isTodo).map((test) => test.fullName);
```

`scanSource()` scans the code of one file without touching the disk. The JSON Schema of the output is exported as
`test-inventory/schema/v1.json`, so a reader can pin the version of the format it understands.

## Limits

- Config files are not read, so `grep`, projects and Vitest tag options in them do not change the output.
- Values imported from other files are not worked out. A tag or title that comes from an import gets a diagnostic
  that names the module. A custom `test` object is followed one file deep, through a relative path, a tsconfig path
  alias, a `#` import in package.json or a workspace package; one that can't be followed gets an error. Tests
  declared inside a function imported from another file are not listed.
- A test in a loop or a `.each` table is one record, with `isInLoop` or `caseCount`; the runner creates one test per
  iteration or case.
- Conditions such as `browserName === 'webkit'` are kept as source text, not evaluated.

## Performance

Files are read one at a time and the JSON is written one record at a time. Scanning the 196 Vitest files of
[vuejs/core](https://github.com/vuejs/core) at commit 4ab865a (3,592 tests) took 1.22 s and 187 MB of peak memory,
the median of nine runs of the command line pinned to two cores with `taskset -c 0,1`, on a 16-core Ryzen 7 9800X3D
desktop under WSL 2 with Node.js 26.9.

## Support

If test-inventory is useful to you, [star it on GitHub](https://github.com/Huldoser/test-inventory) or
[sponsor its development](https://github.com/sponsors/Huldoser).

## License

[MIT](LICENSE), copyright © 2026 [Andrey Rychkov](https://github.com/Huldoser).
