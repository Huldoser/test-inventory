---
description: Install test-inventory and list the tests of a Playwright, Vitest, Jest, Mocha, Jasmine, Cypress, WebdriverIO, node:test or Bun suite as JSON, without running them.
---

# Getting started

test-inventory reads JavaScript and TypeScript test files and lists the tests in them as JSON. It parses the code
and never runs it. You need no browsers, build or additional runner setup. This walkthrough scans an existing
project, checks the result and lists tests marked skip or fixme.

You need Node.js 22.12 or newer and an existing JavaScript or TypeScript test suite. The scanner runs on Linux, macOS
and Windows, on x64 and Arm. For an AI client, use the [MCP setup](/guide/agents) instead.

## Install

```sh
npm install --save-dev test-inventory
```

## Scan your project

From the folder containing the project's `package.json`, run:

```sh
npx test-inventory --pretty --output inventory.json
```

The scanner detects the runner and reads supported config settings to choose files. If the project has several
runners, pass `--framework`. You can also provide quoted globs to choose files explicitly. For a Playwright project
with specs in `tests/`:

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
```

To try the package without installing it first, run either command with `npx`; it may ask to download the package.
The scan writes `inventory.json`, replacing an existing output file once the new output is complete. It does not run
the tests or change their source files.

## Check the result

Print the counts and diagnostic messages from the saved file:

```sh
node -e "const i = require('./inventory.json'); console.log(i.summary); console.log(i.diagnostics)"
```

For a project with matching tests, `summary.fileCount` and `summary.testCount` should be greater than zero. Review
diagnostics even when the command exits with 0: errors may mean tests are missing. If the result is empty or
unexpected, use [troubleshooting](/guide/troubleshooting).

To list tests marked skip or fixme, with their conditions and reasons:

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --state skip --state fixme --fields fullName,state,condition,reason --pretty
```

A conditional state is not proof that a test was skipped in a run. Expected-to-fail tests execute and check for
failure; they are not disabled tests. [Key concepts](/guide/concepts) explains these distinctions and how counts work.

## Scan a Playwright suite

Take a spec from the UI tests of a trading app, `tests/orders/limit-orders.spec.ts`:

<!-- code: trading-web/tests/orders/limit-orders.spec.ts -->

```ts excerpt
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

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --pretty --output inventory.json
```

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

### Gherkin features with playwright-bdd

Generate Playwright files before scanning a Gherkin suite. The [BDD example](/guide/examples#gherkin-features-with-playwright-bdd)
shows the commands and explains which files the records refer to.

## Scan a Vitest suite

<!-- scan: strategy-engine -->

```sh
npx test-inventory "tests/**/*.{test,test-d}.ts" "src/**/*.ts" --framework vitest --output inventory.json
```

Include the source files when they contain [in-source tests](https://vitest.dev/guide/in-source), and the
`*.test-d.ts` files for [type tests](https://vitest.dev/guide/testing-types).

## Scan a Jest suite

In a project that uses only Jest, no options are needed: the scan finds Jest in `package.json` and the test files
from the Jest config, or from Jest's defaults when there is none.

```sh
npx test-inventory --output inventory.json
```

With globs, name the runner:

<!-- scan: settlement-service -->

```sh
npx test-inventory "src/**/*.test.js" "src/__tests__/*.js" "tests/**/*.test.js" --framework jest --output inventory.json
```

## Supported runners

These are minimum supported versions. [Compared with the runners](/guide/runners#checked-in-ci) lists the specific
versions checked in CI; it does not claim every later release has been tested.

- [Playwright](https://playwright.dev): Playwright 1.42 or newer.
- [Vitest](https://vitest.dev): Vitest 3.0 or newer.
- [Jest](https://jestjs.io): Jest 29.0 or newer.
- [Mocha](https://mochajs.org): Mocha 10.0 or newer.
- [Jasmine](https://jasmine.github.io): Jasmine 4.0 or newer.
- [Cypress](https://www.cypress.io): Cypress 13.0 or newer.
- [WebdriverIO](https://webdriver.io): WebdriverIO 9.0 or newer, with Mocha or Jasmine.
- [node:test](https://nodejs.org/api/test.html): node:test 22.0 or newer, using the Node.js version.
- [Bun](https://bun.com): Bun 1.2.23 or newer.

## Next

- [One task, three interfaces](/guide/workflows): a complete downloadable script, CLI query and MCP workflow.

- [Examples](/guide/examples) for end-to-end tests, a Node service, React, Vue, browser mode, a monorepo, Jest, Mocha,
  Jasmine, Cypress, WebdriverIO, node:test, Bun and Puppeteer.
- The [command line](/guide/cli) options.
- [Query recipes](/guide/recipes) and [CI recipes](/guide/ci).
- The [MCP server and other ways in](/guide/agents) for AI agents.
- Every key in the [output](/reference/output).
- The [diagnostics](/reference/diagnostics): what the scan could not read, and why.
