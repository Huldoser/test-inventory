---
description: Scan Vitest tests without running them, interpret the inventory, and check Vitest syntax and limitations.
prev: false
next:
  text: Vitest examples
  link: /frameworks/vitest-examples
---

# Vitest

This guide covers **Vitest 1.0 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
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

A suite's `only`, `skip` and `todo` options pass to its descendants. Before Vitest 4.1 they set the
children's options without changing the suite's own mode. From 4.1 they also set the suite's mode. In Vitest 4 and
earlier, an inherited `skip: false` can clear a test's `.skip`, and `todo: false` can clear its `.todo`. From Vitest 5
the test's modifier wins over the inherited option. A test's own explicit option wins in both cases. A configured tag
can override the inherited suite option in Vitest 5. In Vitest 4.1 the inherited option takes precedence over a tag.
For example, a suite with `{ only: true }` can make a child marked `.skip` run. In Vitest 5 a tag with
`only: false` restores that child's skip. The suite still focuses the file.

From Vitest 4.0.17, a focused suite with focused tests or suites inside it selects those children.
Other tests in the same suite have `isOnly: false`. Earlier versions also select the plain siblings.

A suite's `fails: true` makes a test count as `expectedToFail` when the test inherits that option.
A nested suite or test can clear it with `fails: false`. In Vitest 4 and earlier, an inherited
`fails: false` also clears a test's `.fails` modifier. In Vitest 5 the modifier takes precedence.
When a focus tag makes a skipped or todo test run, its own `.fails` or `fails: true` still applies.

`isParallel` follows the runner's scheduling options. Before Vitest 4.1.6, a test with
`concurrent: false` can still run concurrently when `sequence.concurrent` is enabled.
From 4.1.6 that test setting takes precedence over the default. Through Vitest 4, all projects use the root config's `sequence.concurrent`. From Vitest 5,
each project supplies its own default. Vitest 5 ignores the
`sequential` option and reads `concurrent: false` to turn concurrency off.

## Example

<!--@include: ../guide/examples.md#example-vitest-->

Other Vitest examples: [React](/frameworks/vitest-examples#react-with-testing-library), [Vue](/frameworks/vitest-examples#vue-with-vue-test-utils), [browser mode](/frameworks/vitest-examples#vitest-browser-mode), [in-source and type tests](/frameworks/vitest-examples#in-source-and-type-tests), [monorepos](/frameworks/vitest-examples#a-monorepo).

## Configuration and limits

A local module can re-export a Vitest test function under another name. For a JavaScript call with a title, options
and a callback, Vitest reads those three arguments even if more follow. The scan keeps the timeout in the options.

The scan finds `vitest.config.*`, or `vite.config.*` when absent, in the test file's folder and its ancestors.
A config elsewhere that reaches the file counts only when a package.json script in the file's folder or above names
it, as in `vitest run --config vitest.config.integration.mts`; its globs are then read from the folder the script runs
in, or its `--root`. Without globs, such a file is also found when no config above it runs it, or the scan can't read
the one there. A script that starts Vitest in a package without a config runs Vitest's defaults there, and
before Vitest 5 the config above it. It reads file and project selection,
`test.globals`, run settings, modes, `allowOnly` and defined tags. A Vitest 3 project list in
`vitest.workspace.*` or `test.workspace` is not read, so the config is taken to run the file.

During discovery, a package script such as `vitest run orders` selects eligible files whose paths contain
`orders`, ignoring case. A script can supply multiple filters, including a directory relative to the package.
A literal `cd desk && vitest run` starts discovery in `desk`. Discovery collects files selected by any script using the config. See [package script file filters](/reference/output#configs).

Paths and globs in `test.projects` start at `test.root`, then Vite's `root` if set.
If the scan cannot read the root, it reports unknown membership for those entries.

Without globs, a project list the scan can't read, as one built from the folders, a function in `test.projects`, or
`test.workspace`, leaves candidates: the files the config's own `include` and `exclude` select, as projects mostly
narrow those. Their tests' `projects` is `null`, and a `config-value-unknown` error says tests may be missing. With a
`test.include` it can't read there are no candidates; give globs. An `exclude` it can't read in full still leaves out
the files its readable entries name, with a warning that the scan may list files Vitest leaves out.

A tag whose definition cannot be worked out produces a `config-may-change-state` warning on files using tags:
the tag may skip a test or change its settings. `vi.setConfig()` and `annotate()` in hooks are not read.

A browser instance whose `browser` or `name` the scan can't work out, as one `process.env` picks, or a
`browser.enabled` it can't, leaves the config's files listed, with a warning, and their tests' `projects` `null`.

`resolve.alias` and `test.alias` are followed for imports and dependency hashes. `mergeConfig` puts overriding
list aliases first, converting object aliases to lists when either side is a list; two objects keep overriding
values. Config paths built with string `+` or a template over `__dirname` or `import.meta.dirname` are read.

### Tables and case titles

Vitest's titles follow the rules of the project's Vitest version: `%s`, `%d`, `%i`, `%f`, `%j`, `%o`, `%O`, `%c`, `%#`,
`%$` and `$name`, with values cut as the config of the project that runs the file cuts them:
`taskTitleValueFormatTruncate`, or before Vitest 5 `chaiConfig.truncateThreshold`, and 40 characters, Vitest's default,
when it sets neither. A table stays one record, with a `cases-not-expanded` warning, when the scan can't work out a
value in it or its title, or the title would show an array or object. A table shared by multiple projects also stays
as one record when those projects shorten a case title differently. Cases whose titles agree still expand when the
projects use different length limits. If the config computes the length at runtime, a table expands only when
its case titles are independent of that setting.

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
