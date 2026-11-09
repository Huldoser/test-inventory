---
description: Scan Jest tests without running them, interpret the inventory, and check Jest syntax and limitations.
---

# Jest

This guide covers **Jest 29.0 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
existing JavaScript or TypeScript test suite. The scanner reads your source without executing your tests or starting
a browser. These are minimum supported versions; [CI comparisons](/guide/runners#checked-in-ci) list tested versions.

[Choose another framework](/frameworks/) · [Use an AI client](/guide/agents)

## Install

<!--@include: ../guide/getting-started.md#install-->

## Scan your suite

Run from the folder containing your project's `package.json`:

```sh
npx test-inventory --framework jest --pretty --output inventory.json
```

To select files explicitly, use quoted globs. This example matches the `settlement-service` fixture used below;
adjust the globs to your suite's layout:

<!-- scan: settlement-service -->

```sh
npx test-inventory "src/**/*.test.js" "src/__tests__/*.js" "tests/**/*.test.js" --framework jest --output inventory.json
```

The command replaces `inventory.json` once the new output is complete. It does not change your test files.

## Check the result

<!--@include: ../guide/getting-started.md#check-result-->

## Find skipped tests

<!-- scan: settlement-service -->

```sh
npx test-inventory "src/**/*.test.js" "src/__tests__/*.js" "tests/**/*.test.js" --framework jest --state skip --fields fullName,state,condition,reason --pretty
```

This selects source declarations marked skip; it is not a report of a test run.
See [query recipes](/guide/recipes) for other inventory queries.

## Example

<!--@include: ../guide/examples.md#example-jest-->

Other Jest examples: [Puppeteer on Jest](/guide/examples#puppeteer-on-jest).

## Configuration and limits

The scan reads the root `jest.config.*`, otherwise `package.json`, plus configs named in `projects`.
From Jest 30, a string-valued `jest` key names a config file. Multiple configs in the same folder produce a
`config-value-unknown` warning because Jest refuses them. With no root config, Jest's defaults apply.
`injectGlobals` and supported run settings are read.

A config built by Next.js's `createJestConfig(config)` is not worked out. A package `preset` is not read;
if it may select files and neither `testMatch` nor `testRegex` is set explicitly, `config-value-unknown`
reports that Jest's defaults are used. A local preset path is read.

A config Jest refuses, such as one excluding `js` from `moduleFileExtensions` or naming nonexistent `roots`,
is read as written. Assigning its properties one by one, such as `module.exports.testMatch = [...]`, is not read.
`moduleNameMapper`, `modulePaths` and `moduleDirectories` are followed for imports and dependency hashes;
runtime mappings that cannot be worked out are left out.

`jest.setTimeout()` and `jest.retryTimes()` inside tests, hooks or functions are not read.
Tests registered by functions that setup files put on `globalThis`, or packages such as `babel-plugin-tester`,
can be missing without a diagnostic when the call does not look like a test.
Flow annotations cannot be parsed, even if Babel would compile them before Jest runs; those files get
`parse-error` and their tests are missing.

::: details Exact file selection

<!--@include: ../reference/output.md#files-jest-->

:::

## Supported syntax

<!--@include: ../reference/syntax.md#syntax-jest-->

The [shared syntax rules](/reference/syntax#in-every-runner) also apply.

## Next

- [Shared limits](/guide/limits): imports, generated tests, conditions and dependency coverage.
- [Key concepts](/guide/concepts): counts, states, IDs and hashes.
- [Output reference](/reference/output) and [diagnostics](/reference/diagnostics): interpret every field and warning.
- [CLI](/guide/cli), [library](/guide/library) and [MCP](/guide/agents): use the same inventory through each interface.
- [Compare runners](/guide/runners): differences from runner collection and execution reports.
