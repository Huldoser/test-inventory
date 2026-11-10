---
description: Scan Playwright tests without running them, interpret the inventory, and check Playwright syntax and limitations.
prev: false
next:
  text: Query recipes
  link: /guide/recipes
---

# Playwright

This guide covers **Playwright 1.42 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
existing JavaScript or TypeScript test suite. The scanner reads your source without executing your tests or starting
a browser. These are minimum supported versions; [CI comparisons](/guide/runners#checked-in-ci) list tested versions.

[Choose another framework](/frameworks/) · [Use an AI client](/guide/agents)

## Install

<!--@include: ../guide/getting-started.md#install-->

## Scan your suite

Run from the folder containing your project's `package.json`:

```sh
npx test-inventory --framework playwright --pretty --output inventory.json
```

To select files explicitly, use quoted globs. This example matches the `trading-web` fixture used below;
adjust the globs to your suite's layout:

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
```

The command replaces `inventory.json` once the new output is complete. It does not change your test files.

## Check the result

<!--@include: ../guide/getting-started.md#check-result-->

## Find skipped tests

```sh
npx test-inventory --framework playwright --state skip --state fixme --fields fullName,state,condition,reason --pretty
```

This uses the same file selection as the first scan. If you supplied globs, `--root` or `--framework-version`,
repeat those options here.

This selects source declarations marked skip or fixme; it is not a report of a test run.
See [query recipes](/guide/recipes) for other inventory queries.

## Example

<!--@include: ../guide/examples.md#example-playwright-->

## Playwright projects and declaration counts

<!--@include: ../guide/examples.md#example-playwright-projects-->

## Configuration and limits

The scan finds `playwright.config.*` in the test file's folder and its ancestors. A config elsewhere that
reaches the file, such as `apps/web/playwright.config.ts` with `testDir: '../../e2e'`, is not found from it.
It reads file and project selection, run settings, modes and `forbidOnly`. Other settings, such as `workers`
and config `use`, are not interpreted as test record settings.

A config chosen with the runner's `--config` is not inferred from the files. A config built by a call the scan
cannot follow, such as `getPlaywrightConfig({ startCommand: 'pnpm start' })`, cannot be worked out.

For a project's `grep`, the test's text contains its project, file, config `tag`, describe and test titles and tags.
Option tags are placed at the end; Playwright places a describe's tags after its title. Only a pattern depending
on that order can distinguish them. A test excluded by `grep` remains in the inventory, with that project missing
from its `projects`.

Calls to `testInfo.setTimeout()` and `testInfo.slow()` are not read. Nor are calls in an imported function passed
to a hook by name, such as `test.beforeEach(slowOnCI)`.

A loop that registers the same title path twice gives a `duplicate-title` error and `notLoaded` tests, as
Playwright refuses the file.

### States set in helper functions

In Playwright, a `test.skip()`, `test.fixme()`, `test.fail()` or `test.describe.configure()` call inside a plain
function applies to the tests, hooks and describes that call that function by name, also through helpers that call
other helpers. A function called from the file or a describe may also be imported from another file:

```ts
function skipWithoutMarketData() {
  test.skip(!process.env.MARKET_DATA_URL, 'needs the market data feed');
}

test('streams AAPL quotes', async ({ page }) => {
  skipWithoutMarketData(); // state: skip, isConditional: true
});
```

When the file exports the function, or nothing in the file calls it by name, the scan can't tell which tests it
affects, and a `state-in-helper` warning says the call was not applied. A function the file declares and passes by
name to a hook or a test, as in `test.beforeEach(skipWithoutMarketData)`, is read as if its code were written there.

### Fixtures, snapshots and dependency hashes

The hash does not follow `webServer` commands or `teardown` projects. Nondefault snapshot paths from
`snapshotPathTemplate`, `snapshotDir` or a matcher's `pathTemplate` give snapshot tests a
`dependency-not-followed` warning at that setting.

A test's fixtures are those requested by the test, surrounding hooks, conditions such as
`test.skip(({ account }) => ...)` and `test.use()` values in reachable code, including helpers taking the test
object, plus the fixtures those request. Taking the fixtures object whole, an unreadable fixture function (such as
a hook returned by a factory or held in a `let`), or a fixture from an installed package includes every fixture
of the test object. An automatic fixture, or an override of built-in fixtures or options such as `page`, `context`,
`storageState` or `baseURL`, enters every test's hash. `base.extend(fixtures)` without an object literal takes
all fixtures.

A screenshot without a name, or with a runtime name, takes all files in the spec's `-snapshots` folder. A known
name takes every matching prefix, so `holdings.png` also takes `holdings-by-sector-chromium-linux.png`.
These broader dependencies can change a hash even when the changed code does not affect that test.

::: details Exact file selection

<!--@include: ../reference/output.md#files-playwright-->

:::

## Supported syntax

<!--@include: ../reference/syntax.md#syntax-playwright-->

The [shared syntax rules](/reference/syntax#in-every-runner) also apply.

## Next

- [Shared limits](/guide/limits): imports, generated tests, conditions and dependency coverage.
- [Key concepts](/guide/concepts): counts, states, IDs and hashes.
- [Output reference](/reference/output) and [diagnostics](/reference/diagnostics): interpret every field and warning.
- [CLI](/guide/cli), [library](/guide/library) and [MCP](/guide/agents): use the same inventory through each interface.
- [Compare runners](/guide/runners): differences from runner collection and execution reports.
