---
description: Try test-inventory without installing, scan a Playwright, Vitest, Jest, Mocha, Jasmine, Cypress, WebdriverIO, node:test or Bun suite, and query skipped or affected tests.
---

# Getting started

test-inventory reads JavaScript and TypeScript test files and configs from source without running the suite. You need
Node.js 22.12 or newer (Linux, macOS or Windows, x64 or Arm) and an existing test suite.

Looking for another entry point? Use the [GitHub Action](/guide/ci#comment-on-pull-requests) for automatic pull request
comments or the [MCP server](/guide/agents) for AI coding clients.

## Try it without installing

From your project folder (where `package.json` lives), list tests marked skip or fixme with their conditions and reasons:

```sh
npx test-inventory --state skip --state fixme --fields fullName,state,condition,reason --pretty
```

Or print the runner command for tests affected by files changed on your branch:

```sh
git diff --name-only origin/main... | npx test-inventory --related - --format commands
```

`npx` may ask to download the package on first run. The scanner detects your runner and reads its config automatically.
If your project uses several runners, add `--framework <name>`.

## Choose your framework

For runner-specific commands, examples, syntax and limits, jump straight to your runner's guide:

[Playwright](/frameworks/playwright) · [Vitest](/frameworks/vitest) · [Jest](/frameworks/jest) · [Mocha](/frameworks/mocha) · [Jasmine](/frameworks/jasmine) · [Cypress](/frameworks/cypress) · [WebdriverIO](/frameworks/webdriverio) · [node:test](/frameworks/node) · [Bun](/frameworks/bun)

[All framework guides](/frameworks/) also covers mixed-runner repositories.

## Install

Add `test-inventory` as a dev dependency when you want reproducible scans in CI, package scripts or Node.js code:

<!-- #region install -->

```sh
npm install --save-dev test-inventory
```

<!-- #endregion install -->

## Save a full inventory

To save the full inventory to disk for querying, diffing or CI checks:

```sh
npx test-inventory --pretty --output inventory.json
```

You can also pass quoted globs and `--framework` to pick files explicitly. For example, a Playwright project with specs
in `tests/`:

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
```

The scan replaces `inventory.json` once the new output is complete. It never runs your tests or changes source files.

## Check the result

<!-- #region check-result -->

Print the summary counts and any diagnostics from the saved file:

```sh
node -e "const i = require('./inventory.json'); console.log(i.summary); console.log(i.diagnostics)"
```

Before acting on the numbers:

- **Check `diagnostics` even when the command exits with 0:** errors mean files failed to parse, imports could not be
  followed, or config settings were unreadable, so tests may be missing. Use [troubleshooting](/guide/troubleshooting)
  if counts look empty or unexpected.
- **Declarations are not execution results:** a conditional skip keeps its condition as source text and does not prove
  a run skipped the test. `expectedToFail` tests still run.
- **Loops and tables count as one record by default:** pass `--expand-cases` to list each known case separately. Read
  [key concepts](/guide/concepts) and [shared limits](/guide/limits) before gating CI on a scan.

<!-- #endregion check-result -->

<span id="scan-a-playwright-suite"></span><span id="gherkin-features-with-playwright-bdd"></span><span id="scan-a-vitest-suite"></span><span id="scan-a-jest-suite"></span>

## Supported runners

Minimum supported versions (see [checked in CI](/guide/runners#checked-in-ci) for the exact versions compared against
real runners on every pull request):

- [Playwright](/frameworks/playwright): Playwright 1.31 or newer (includes [Gherkin features with playwright-bdd](/frameworks/playwright#gherkin-features-with-playwright-bdd)).
- [Vitest](/frameworks/vitest): Vitest 1.0 or newer.
- [Jest](/frameworks/jest): Jest 27.0 or newer.
- [Mocha](/frameworks/mocha): Mocha 10.0 or newer.
- [Jasmine](/frameworks/jasmine): Jasmine 3.0 or newer.
- [Cypress](/frameworks/cypress): Cypress 10.0 or newer.
- [WebdriverIO](/frameworks/webdriverio): WebdriverIO 7.0 or newer, with Mocha or Jasmine.
- [node:test](/frameworks/node): node:test 22.0 or newer, using the Node.js version.
- [Bun](/frameworks/bun): Bun 1.2.23 or newer.

## Next

- [One task, three interfaces](/guide/workflows): run the same query through the CLI, a library script and MCP.
- [Query recipes](/guide/recipes) and [CI recipes](/guide/ci) (including the [GitHub Action](/guide/ci#comment-on-pull-requests)).
- [Compare inventories](/guide/diff): diff saved scans across commits or pull requests.
- [AI agents](/guide/agents): connect `test-inventory-mcp` to Claude Code, Cursor or VS Code.
- [Examples](/guide/examples) across all 9 runners, [command line reference](/guide/cli), [output reference](/reference/output) and [diagnostics](/reference/diagnostics).
