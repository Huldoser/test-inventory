# Getting started

test-inventory reads JavaScript and TypeScript test files and lists the tests in them as JSON. It parses the code
and never runs it, so it needs no browsers, no build and no configuration of the test runner.

0.1 supports [Playwright](https://playwright.dev) 1.42 and newer and [Vitest](https://vitest.dev) 3.0 and newer. It
needs Node.js 22.12 or newer, and runs on Linux, macOS and Windows, on x64 and Arm.

## Install

::: code-group

```sh [npm]
npm install --save-dev test-inventory
```

```sh [pnpm]
pnpm add --save-dev test-inventory
```

```sh [yarn]
yarn add --dev test-inventory
```

```sh [bun]
bun add --dev test-inventory
```

:::

## Scan a Playwright suite

Take a spec from the UI tests of a trading app, `tests/orders/limit-orders.spec.ts`:

<!-- code: trading-web/tests/orders/limit-orders.spec.ts -->

```ts
import { test, expect } from '../../fixtures/index';
import { TAGS } from '../../test-data/tags';

test.describe('orders', { tag: '@orders' }, () => {
  test.describe('limit orders', () => {
    // ...
    // FIXME: TRD-412 the confirm dialog stays open on WebKit
    test(
      'rejects a limit price far from the last trade',
      { annotation: { type: 'issue', description: 'TRD-412' } },
      async ({ browserName, orderTicket }) => {
        test.fixme(browserName === 'webkit', 'confirm dialog stays open on WebKit');
        await orderTicket.buy({ quantity: 1, limitPrice: 1 });
        await expect(orderTicket.error).toHaveText('Limit price is more than 50% away from the last trade.');
      },
    );
  });
});
```

Run the scan from the project root:

::: code-group

<!-- scan: trading-web -->

```sh [npm]
npx test-inventory "tests/**/*.spec.ts" --framework playwright --pretty --output inventory.json
```

```sh [pnpm]
pnpm exec test-inventory "tests/**/*.spec.ts" --framework playwright --pretty --output inventory.json
```

```sh [yarn]
yarn test-inventory "tests/**/*.spec.ts" --framework playwright --pretty --output inventory.json
```

```sh [bun]
bunx test-inventory "tests/**/*.spec.ts" --framework playwright --pretty --output inventory.json
```

:::

The test's record in `inventory.json`, shortened:

<!-- output: trading-web -->

```json
{
  "id": "da2f5749ba9ab068",
  "relativeFilePath": "tests/orders/limit-orders.spec.ts",
  "lineStart": 24,
  "lineEnd": 32,
  "fullName": "orders > limit orders > rejects a limit price far from the last trade",
  "state": "fixme",
  "isFixme": true,
  "isConditional": true,
  "condition": "browserName === 'webkit'",
  "reason": "confirm dialog stays open on WebKit",
  "stateSource": "test",
  "stateLine": 28,
  "tags": ["@orders"],
  "annotations": [{ "type": "issue", "description": "TRD-412", "lineStart": 26 }],
  "comments": ["FIXME: TRD-412 the confirm dialog stays open on WebKit"]
}
```

The test imports `test` from a local fixtures file. The scan follows that one import to check that it exports a
Playwright test object created with `test.extend()`.

## Scan a Vitest suite

<!-- scan: strategy-engine -->

```sh
npx test-inventory "tests/**/*.{test,test-d}.ts" "src/**/*.ts" --framework vitest --output inventory.json
```

Include the source files when they contain [in-source tests](https://vitest.dev/guide/in-source), and the
`*.test-d.ts` files for [type tests](https://vitest.dev/guide/testing-types).

## Next

- [Examples](/guide/examples) for end-to-end tests, a Node service, React, Vue, browser mode and a monorepo.
- The [command line](/guide/cli) options.
- [Query recipes](/guide/recipes) in jq, DuckDB, Node.js and Python, and [CI recipes](/guide/ci).
- Every key in the [output](/reference/output).
- The [diagnostics](/reference/diagnostics): what the scan could not read, and why.
