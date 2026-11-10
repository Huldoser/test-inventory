---
description: Scan Bun tests without running them, interpret the inventory, and check Bun syntax and limitations.
prev: false
next:
  text: Query recipes
  link: /guide/recipes
---

# Bun

This guide covers **Bun 1.2.23 or newer**. You need Node.js 22.12 or newer to run test-inventory and an
existing JavaScript or TypeScript test suite. The scanner reads your source without executing your tests or starting
a browser. These are minimum supported versions; [CI comparisons](/guide/runners#checked-in-ci) list tested versions.

[Choose another framework](/frameworks/) · [Use an AI client](/guide/agents)

## Install

<!--@include: ../guide/getting-started.md#install-->

## Scan your suite

Run from the folder containing your project's `package.json`:

```sh
npx test-inventory --framework bun --pretty --output inventory.json
```

To select files explicitly, use quoted globs. This example matches the `quote-gateway` fixture used below;
adjust the globs to your suite's layout:

<!-- scan: quote-gateway -->

```sh
npx test-inventory "src/**/*.test.ts" "src/**/*.spec.ts" --framework bun --output inventory.json
```

The command replaces `inventory.json` once the new output is complete. It does not change your test files.

## Check the result

<!--@include: ../guide/getting-started.md#check-result-->

## Find skipped tests

```sh
npx test-inventory --framework bun --state skip --fields fullName,state,condition,reason --pretty
```

This uses the same file selection as the first scan. If you supplied globs, `--root` or `--framework-version`,
repeat those options here.

This selects source declarations marked skip; it is not a report of a test run.
See [query recipes](/guide/recipes) for other inventory queries.

## Example

<!--@include: ../guide/examples.md#example-bun-->

## Bun parameterized tests

<!--@include: ../guide/examples.md#example-bun-cases-->

## Configuration and limits

The scan reads the root `bunfig.toml` `[test]` table. Without it, files have no config.
Explicit globs count as files given to `bun test`. Supported settings include `root`, `pathIgnorePatterns`,
`concurrentTestGlob` and, from Bun 1.3, `retry`. Invalid pattern settings are reported.
Malformed inline tables, including entries without a comma between them, produce a config diagnostic.

`[test].preload` files enter dependency hashes but are not executed. A focused test can make Bun omit other
tests from its run report; the inventory keeps all declarations and their `isOnly` flags.
Run the scanner with Node.js, even when the scanned tests use Bun.

See [Bun file selection](/reference/output#bun-file-selection) for exact defaults and version differences.

## Supported syntax

<!--@include: ../reference/syntax.md#syntax-bun-->

The [shared syntax rules](/reference/syntax#in-every-runner) also apply.

## Next

- [Shared limits](/guide/limits): imports, generated tests, conditions and dependency coverage.
- [Key concepts](/guide/concepts): counts, states, IDs and hashes.
- [Output reference](/reference/output) and [diagnostics](/reference/diagnostics): interpret every field and warning.
- [CLI](/guide/cli), [library](/guide/library) and [MCP](/guide/agents): use the same inventory through each interface.
- [Compare with Bun](/guide/runners#bun-s-list): differences from runner collection and execution reports.
