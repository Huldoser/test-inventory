---
description: Scan node:test tests without running them, interpret the inventory, and check node:test syntax and limitations.
prev: false
next:
  text: Query recipes
  link: /guide/recipes
---

# node:test

This guide covers **node:test 22.0 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
existing JavaScript or TypeScript test suite. The scanner reads your source without executing your tests or starting
a browser. These are minimum supported versions; [CI comparisons](/guide/runners#checked-in-ci) list tested versions.

[Choose another framework](/frameworks/) · [Use an AI client](/guide/agents)

## Install

<!--@include: ../guide/getting-started.md#install-->

## Scan your suite

Run from the folder containing your project's `package.json`:

```sh
npx test-inventory --framework node --pretty --output inventory.json
```

To select files explicitly, use quoted globs. This example matches the `pricing-service` fixture used below;
adjust the globs to your suite's layout:

<!-- scan: pricing-service -->

```sh
npx test-inventory "test/**/*.js" "src/**/*.test.js" --framework node --output inventory.json
```

The command replaces `inventory.json` once the new output is complete. It does not change your test files.

## Check the result

<!--@include: ../guide/getting-started.md#check-result-->

## Find skipped tests

```sh
npx test-inventory --framework node --state skip --fields fullName,state,condition,reason --pretty
```

This uses the same file selection as the first scan. If you supplied globs, `--root` or `--framework-version`,
repeat those options here.

This selects source declarations marked skip; it is not a report of a test run.
See [query recipes](/guide/recipes) for other inventory queries.

## Example

<!--@include: ../guide/examples.md#example-node-->

## Configuration and limits

Use `--framework node` for node:test. The scanner itself still needs Node.js 22.12 or newer.
There is no config file the scan reads: `node.config.json` holds no file selection and Node.js reads it only
with `--config-file`. File selection comes from supported `node --test` package scripts or explicit globs.

Script `--import`, `--require` and `--test-global-setup` files enter dependency hashes. They are not executed.
The inventory lists tests inside skipped suites; the runner may report only the enclosing skipped entry.
`isOnly` records the source modifier, while node:test applies it only with `--test-only`.

::: details Exact file selection

<!--@include: ../reference/output.md#files-node-->

:::

## Supported syntax

<!--@include: ../reference/syntax.md#syntax-node-->

The [shared syntax rules](/reference/syntax#in-every-runner) also apply.

## Next

- [Shared limits](/guide/limits): imports, generated tests, conditions and dependency coverage.
- [Key concepts](/guide/concepts): counts, states, IDs and hashes.
- [Output reference](/reference/output) and [diagnostics](/reference/diagnostics): interpret every field and warning.
- [CLI](/guide/cli), [library](/guide/library) and [MCP](/guide/agents): use the same inventory through each interface.
- [Compare with node:test](/guide/runners#node-test-s-list): differences from runner collection and execution reports.
