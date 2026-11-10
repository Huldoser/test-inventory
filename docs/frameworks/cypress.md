---
description: Scan Cypress tests without running them, interpret the inventory, and check Cypress syntax and limitations.
prev: false
next:
  text: Query recipes
  link: /guide/recipes
---

# Cypress

This guide covers **Cypress 13.0 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
existing JavaScript or TypeScript test suite. The scanner reads your source without executing your tests or starting
a browser. These are minimum supported versions; [CI comparisons](/guide/runners#checked-in-ci) list tested versions.

[Choose another framework](/frameworks/) · [Use an AI client](/guide/agents)

## Install

<!--@include: ../guide/getting-started.md#install-->

## Scan your suite

Run from the folder containing your project's `package.json`:

```sh
npx test-inventory --framework cypress --pretty --output inventory.json
```

To select files explicitly, use quoted globs. This example matches the `trading-ui-cypress` fixture used below;
adjust the globs to your suite's layout:

<!-- scan: trading-ui-cypress -->

```sh
npx test-inventory "cypress/e2e/**/*.cy.js" --framework cypress --output inventory.json
```

The command replaces `inventory.json` once the new output is complete. It does not change your test files.

## Check the result

<!--@include: ../guide/getting-started.md#check-result-->

## Find skipped tests

```sh
npx test-inventory --framework cypress --state skip --fields fullName,state,condition,reason --pretty
```

This uses the same file selection as the first scan. If you supplied globs, `--root` or `--framework-version`,
repeat those options here.

This selects source declarations marked skip; it is not a report of a test run.
See [query recipes](/guide/recipes) for other inventory queries.

## Example

<!--@include: ../guide/examples.md#example-cypress-->

## Cypress component and end-to-end tests

<!--@include: ../guide/examples.md#example-cypress-component-->

## Configuration and limits

The scan reads the first `cypress.config.*` in the root. Its `e2e` and configured `component` testing types
become projects. Explicit scan globs still need to match the testing type's `specPattern` for the file to count
as run, as with `cypress run --spec`. Component selection also excludes the e2e `specPattern` matches.

The testing type's `retries`, otherwise the config's, applies; an object uses `runMode`. Support files,
including the default support file, enter dependency hashes but are not executed. Browser-dependent skips
describe conditions in source, not proof that a browser skipped the test.

::: details Exact file selection

<!--@include: ../reference/output.md#files-cypress-->

:::

## Supported syntax

<!--@include: ../reference/syntax.md#syntax-cypress-->

The [shared syntax rules](/reference/syntax#in-every-runner) also apply.

## Next

- [Shared limits](/guide/limits): imports, generated tests, conditions and dependency coverage.
- [Key concepts](/guide/concepts): counts, states, IDs and hashes.
- [Output reference](/reference/output) and [diagnostics](/reference/diagnostics): interpret every field and warning.
- [CLI](/guide/cli), [library](/guide/library) and [MCP](/guide/agents): use the same inventory through each interface.
- [Compare with Cypress](/guide/runners#cypress-s-list): differences from runner collection and execution reports.
