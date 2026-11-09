---
description: Scan WebdriverIO tests without running them, interpret the inventory, and check WebdriverIO syntax and limitations.
prev: false
next:
  text: Query recipes
  link: /guide/recipes
---

# WebdriverIO

This guide covers **WebdriverIO 9.0 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
existing JavaScript or TypeScript test suite. The scanner reads your source without executing your tests or starting
a browser. These are minimum supported versions; [CI comparisons](/guide/runners#checked-in-ci) list tested versions.

[Choose another framework](/frameworks/) · [Use an AI client](/guide/agents)

## Install

<!--@include: ../guide/getting-started.md#install-->

## Scan your suite

Run from the folder containing your project's `package.json`:

```sh
npx test-inventory --framework webdriverio --pretty --output inventory.json
```

To select files explicitly, use quoted globs. This example matches the `broker-portal` fixture used below;
adjust the globs to your suite's layout:

<!-- scan: broker-portal -->

```sh
npx test-inventory "test/specs/*.e2e.js" "test/specs/{orders,accounts}/*.e2e.js" --framework webdriverio --output inventory.json
```

The command replaces `inventory.json` once the new output is complete. It does not change your test files.

## Check the result

<!--@include: ../guide/getting-started.md#check-result-->

## Find skipped tests

```sh
npx test-inventory --framework webdriverio --state skip --fields fullName,state,condition,reason --pretty
```

This uses the same file selection as the first scan. If you supplied globs, `--root` or `--framework-version`,
repeat those options here.

This selects source declarations marked skip; it is not a report of a test run.
See [query recipes](/guide/recipes) for other inventory queries.

## Example

<!--@include: ../guide/examples.md#example-webdriverio-->

## Configuration and limits

The scan reads the root `wdio.conf.js`, `.ts`, `.mjs`, `.mts`, `.cjs` or `.cts`, using its `config` export.
The config's `framework` selects Mocha (the default) or Jasmine. Their syntax is part of WebdriverIO support;
use the matching syntax link below. Cucumber feature files are not read and that selection is reported.

Explicit scan globs replace `specs`, less excludes. `suites`, which need the runner's `--suite`, and
`mochaOpts.grep` or `jasmineOpts.grep` are not read. A spec used by several capabilities or workers is listed
once. The inventory counts declarations, not browser executions.

The config's `mochaOpts.timeout`, `retries` and `ui`, or `jasmineOpts.defaultTimeoutInterval`, apply.
The default timeout is WebdriverIO's 10 seconds; `defaultTimeoutInterval: 0` means 60 seconds.

::: details Exact file selection

<!--@include: ../reference/output.md#files-webdriverio-->

:::

## Supported syntax

<!--@include: ../reference/syntax.md#syntax-webdriverio-->

The [shared syntax rules](/reference/syntax#in-every-runner) also apply.

## Next

- [Shared limits](/guide/limits): imports, generated tests, conditions and dependency coverage.
- [Key concepts](/guide/concepts): counts, states, IDs and hashes.
- [Output reference](/reference/output) and [diagnostics](/reference/diagnostics): interpret every field and warning.
- [CLI](/guide/cli), [library](/guide/library) and [MCP](/guide/agents): use the same inventory through each interface.
- [Compare with WebdriverIO](/guide/runners#webdriverio-s-list): differences from runner collection and execution reports.
