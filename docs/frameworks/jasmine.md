---
description: Scan Jasmine tests without running them, interpret the inventory, and check Jasmine syntax and limitations.
prev: false
next:
  text: Query recipes
  link: /guide/recipes
---

# Jasmine

This guide covers **Jasmine 4.0 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
existing JavaScript or TypeScript test suite. The scanner reads your source without executing your tests or starting
a browser. These are minimum supported versions; [CI comparisons](/guide/runners#checked-in-ci) list tested versions.

[Choose another framework](/frameworks/) · [Use an AI client](/guide/agents)

## Install

<!--@include: ../guide/getting-started.md#install-->

## Scan your suite

Run from the folder containing your project's `package.json`:

```sh
npx test-inventory --framework jasmine --pretty --output inventory.json
```

To select files explicitly, use quoted globs. This example matches the `risk-service` fixture used below;
adjust the globs to your suite's layout:

<!-- scan: risk-service -->

```sh
npx test-inventory "spec/*.spec.js" "spec/limits/**/*.spec.js" --framework jasmine --output inventory.json
```

The command replaces `inventory.json` once the new output is complete. It does not change your test files.

## Check the result

<!--@include: ../guide/getting-started.md#check-result-->

## Find skipped tests

```sh
npx test-inventory --framework jasmine --state skip --fields fullName,state,condition,reason --pretty
```

This uses the same file selection as the first scan. If you supplied globs, `--root` or `--framework-version`,
repeat those options here.

This selects source declarations marked skip; it is not a report of a test run.
See [query recipes](/guide/recipes) for other inventory queries.

## Example

<!--@include: ../guide/examples.md#example-jasmine-->

## Configuration and limits

The scan reads `spec/support/jasmine.mjs` from Jasmine 5, then `.json` or `.js`, in the root.
Without a config it selects no files unless files are explicitly supplied, as Karma and Angular supply them.
Scan globs replace `spec_files`; `JASMINE_CONFIG_PATH` and the runner's `--config` are not read.

Helper globs are included in dependency hashes. Setup and helper code is not executed to discover arbitrary
runtime effects. The record describes `pending()` and disabled declarations from source, not a result from a run.

::: details Exact file selection

<!--@include: ../reference/output.md#files-jasmine-->

:::

## Supported syntax

<!--@include: ../reference/syntax.md#syntax-jasmine-->

The [shared syntax rules](/reference/syntax#in-every-runner) also apply.

## Next

- [Shared limits](/guide/limits): imports, generated tests, conditions and dependency coverage.
- [Key concepts](/guide/concepts): counts, states, IDs and hashes.
- [Output reference](/reference/output) and [diagnostics](/reference/diagnostics): interpret every field and warning.
- [CLI](/guide/cli), [library](/guide/library) and [MCP](/guide/agents): use the same inventory through each interface.
- [Compare with Jasmine](/guide/runners#jasmine-s-list): differences from runner collection and execution reports.
