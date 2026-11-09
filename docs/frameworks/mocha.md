---
description: Scan Mocha tests without running them, interpret the inventory, and check Mocha syntax and limitations.
---

# Mocha

This guide covers **Mocha 10.0 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
existing JavaScript or TypeScript test suite. The scanner reads your source without executing your tests or starting
a browser. These are minimum supported versions; [CI comparisons](/guide/runners#checked-in-ci) list tested versions.

[Choose another framework](/frameworks/) · [Use an AI client](/guide/agents)

## Install

<!--@include: ../guide/getting-started.md#install-->

## Scan your suite

Run from the folder containing your project's `package.json`:

```sh
npx test-inventory --framework mocha --pretty --output inventory.json
```

To select files explicitly, use quoted globs. This example matches the `fix-gateway` fixture used below;
adjust the globs to your suite's layout:

<!-- scan: fix-gateway -->

```sh
npx test-inventory "test/**/*.spec.js" --framework mocha --output inventory.json
```

The command replaces `inventory.json` once the new output is complete. It does not change your test files.

## Check the result

<!--@include: ../guide/getting-started.md#check-result-->

## Find skipped tests

<!-- scan: fix-gateway -->

```sh
npx test-inventory "test/**/*.spec.js" --framework mocha --state skip --fields fullName,state,condition,reason --pretty
```

This selects source declarations marked skip; it is not a report of a test run.
See [query recipes](/guide/recipes) for other inventory queries.

## Example

<!--@include: ../guide/examples.md#example-mocha-->

Other Mocha examples: [Puppeteer on Mocha](/guide/examples#puppeteer-on-mocha).

## Configuration and limits

The scan reads the first `.mocharc.cjs`, `.js`, `.mjs`, `.yaml`, `.yml`, `.jsonc` or `.json` in the root or an
ancestor, combined with the nearest `package.json` `mocha` key. List options such as `spec`, `extension` and
`ignore` are joined; other file values win. Without either config, Mocha's defaults apply.

Explicit scan globs count as supplied specs, less `ignore`, because project scripts often pass Mocha its files.
The config's `timeout`, `retries` and `forbid-only` are read. Runtime or package-provided settings remain unknown.
`this.skip()` is read from source; whether a conditional call actually skips a test needs a run.

::: details Exact file selection

<!--@include: ../reference/output.md#files-mocha-->

:::

## Supported syntax

<!--@include: ../reference/syntax.md#syntax-mocha-->

The [shared syntax rules](/reference/syntax#in-every-runner) also apply.

## Next

- [Shared limits](/guide/limits): imports, generated tests, conditions and dependency coverage.
- [Key concepts](/guide/concepts): counts, states, IDs and hashes.
- [Output reference](/reference/output) and [diagnostics](/reference/diagnostics): interpret every field and warning.
- [CLI](/guide/cli), [library](/guide/library) and [MCP](/guide/agents): use the same inventory through each interface.
- [Compare runners](/guide/runners): differences from runner collection and execution reports.
