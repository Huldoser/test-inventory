---
description: Scan Vitest tests without running them, interpret the inventory, and check Vitest syntax and limitations.
prev: false
next:
  text: Vitest examples
  link: /frameworks/vitest-examples
---

# Vitest

This guide covers **Vitest 3.0 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
existing JavaScript or TypeScript test suite. The scanner reads your source without executing your tests or starting
a browser. These are minimum supported versions; [CI comparisons](/guide/runners#checked-in-ci) list tested versions.

[Choose another framework](/frameworks/) · [Use an AI client](/guide/agents)

## Install

<!--@include: ../guide/getting-started.md#install-->

## Scan your suite

Run from the folder containing your project's `package.json`:

```sh
npx test-inventory --framework vitest --pretty --output inventory.json
```

To select files explicitly, use quoted globs. This example matches the `order-service` fixture used below;
adjust the globs to your suite's layout:

<!-- scan: order-service -->

```sh
npx test-inventory "tests/**/*.test.ts" --framework vitest --output inventory.json
```

The command replaces `inventory.json` once the new output is complete. It does not change your test files.

## Check the result

<!--@include: ../guide/getting-started.md#check-result-->

## Find skipped tests

```sh
npx test-inventory --framework vitest --state skip --fields fullName,state,condition,reason --pretty
```

This uses the same file selection as the first scan. If you supplied globs, `--root` or `--framework-version`,
repeat those options here.

This selects source declarations marked skip; it is not a report of a test run.
See [query recipes](/guide/recipes) for other inventory queries.

## Example

<!--@include: ../guide/examples.md#example-vitest-->

Other Vitest examples: [React](/frameworks/vitest-examples#react-with-testing-library), [Vue](/frameworks/vitest-examples#vue-with-vue-test-utils), [browser mode](/frameworks/vitest-examples#vitest-browser-mode), [in-source and type tests](/frameworks/vitest-examples#in-source-and-type-tests), [monorepos](/frameworks/vitest-examples#a-monorepo).

## Configuration and limits

The scan finds `vitest.config.*`, or `vite.config.*` when absent, in the test file's folder and its ancestors.
A config elsewhere that reaches the file counts only when a package.json script in the file's folder or above names
it, as in `vitest run --config vitest.config.integration.mts`; its globs are then read from the folder the script runs
in, or its `--root`. A script that starts Vitest in a package without a config runs Vitest's defaults there, and
before Vitest 5 the config above it. It reads file and project selection,
`test.globals`, run settings, modes, `allowOnly` and defined tags. A Vitest 3 project list in
`vitest.workspace.*` or `test.workspace` is not read, so the config is taken to run the file.

A tag whose definition cannot be worked out produces a `config-may-change-state` warning on files using tags:
the tag may skip a test or change its settings. `vi.setConfig()` and `annotate()` in hooks are not read.

`resolve.alias` and `test.alias` are followed for imports and dependency hashes. `mergeConfig` puts overriding
list aliases first, converting object aliases to lists when either side is a list; two objects keep overriding
values. Config paths built with string `+` or a template over `__dirname` or `import.meta.dirname` are read.

### Tables and case titles

Vitest's titles follow the rules of the project's Vitest version: `%s`, `%d`, `%i`, `%f`, `%j`, `%o`, `%O`, `%c`, `%#`,
`%$` and `$name`, with values cut as the config of the project that runs the file cuts them:
`taskTitleValueFormatTruncate`, or before Vitest 5 `chaiConfig.truncateThreshold`, and 40 characters, Vitest's default,
when it sets neither. A table stays one record, with a `cases-not-expanded` warning, when the scan can't work out a
value in it or its title, or the title would show an array or object.

Loops over `var` are not expanded because the variable holds its last value by the time Vitest runs describes.
Include source files when scanning in-source tests, and `*.test-d.ts` files for type tests. See the
[in-source and type-test example](/frameworks/vitest-examples#in-source-and-type-tests).

### Mocks, snapshots and dependency hashes

Automatic mocks in `__mocks__` are not followed. A module named by `vi.mock()` enters the hash even when a mock
replaces it. Nondefault snapshot paths from `resolveSnapshotPath`, `snapshotEnvironment` or browser screenshot
settings give snapshot tests a `dependency-not-followed` warning at that setting. Unreadable projects, such as a
Vitest 3 workspace, mark tests with `hasUnfollowedDependencies`; the config's warning identifies the cause.

Vitest keeps one `.snap` file for a spec, so changing one snapshot changes the hash of every test in the spec
using `toMatchSnapshot()`. A custom matcher calling `Snapshots.toMatchSnapshot.call(this, received)` includes
the snapshot file for every test that reaches it.

::: details Exact file selection

<!--@include: ../reference/output.md#files-vitest-->

:::

## Supported syntax

<!--@include: ../reference/syntax.md#syntax-vitest-->

The [shared syntax rules](/reference/syntax#in-every-runner) also apply.

## Next

- [Shared limits](/guide/limits): imports, generated tests, conditions and dependency coverage.
- [Key concepts](/guide/concepts): counts, states, IDs and hashes.
- [Output reference](/reference/output) and [diagnostics](/reference/diagnostics): interpret every field and warning.
- [CLI](/guide/cli), [library](/guide/library) and [MCP](/guide/agents): use the same inventory through each interface.
- [Compare with Vitest](/guide/runners#vitest-5-s-static-list): differences from runner collection and execution reports.
