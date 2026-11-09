---
description: Find missing tests, resolve framework and config problems, and recover from incomplete scans or incompatible inventory diffs.
---

# Troubleshooting

Start with `diagnostics` in the saved inventory. A completed scan can exit with 0 while reporting errors, so the exit
code alone does not establish completeness. The [diagnostic reference](/reference/diagnostics) describes every code.

## No files or tests were found

1. Run from the project root, or pass its folder with `--root`.
2. Check the runner with `--framework`. Its name is `node` for node:test and `bun` for Bun.
3. Try an explicit, quoted glob for files that exist in the project:

   ```sh
   npx test-inventory "tests/**/*.spec.ts" --framework playwright --pretty
   ```

Without globs, runner defaults and the settings the scanner can read from config choose the files. A dynamic config
or a custom location may need explicit globs. A bare folder is not a recursive glob. See `no-files-matched`,
`file-not-run` and `config-value-unknown` in the reference.

If files were found but have no test records, check for `framework-mismatch`, `parse-error` and
`unresolved-test-import` before assuming they contain no tests.

## Several runners were detected

Scan once per runner, using its own patterns and `--framework`. For example, a project can use Playwright for browser
tests and Vitest for unit tests. Do not compare those two inventories with `diff`: their frameworks must match.

## Tests imported from a helper are missing

Read the `unresolved-test-import` message: it identifies where the import chain ends. Check that local files exist
and parse, and that aliases are declared in a supported config or tsconfig. Workspace packages that point only at
missing build output may need their source export corrected.

The scanner does not evaluate wrappers from installed packages. `scanSource()` follows no imports at all; use
`scan()` when the answer needs project files. See [import limits](/guide/limits#values-from-installed-packages-are-not-worked-out).

## A config value or framework version is unknown

Configs are read, not executed. A value derived from environment variables, an installed package or an unsupported
factory can produce `config-value-unknown`. Explicit globs help select files but do not resolve unknown settings.
Fix a supported literal setting only if it represents how your runner should behave; otherwise retain the diagnostic.

For version detection, inspect `frameworkVersion` and its diagnostic. Pass `--framework-version` when you know the
exact runner version but the project does not record it in a supported place. See [version detection](/guide/cli#framework-version).

## The runner reports a different test count

Check whether it creates one execution per table row, loop pass, browser or project. The default scan counts
declarations. Try `--expand-cases` for known tables and loops, and inspect `projects` for browser and project coverage.
Skipped suites, focus and runner-side filters can also explain differences. See [key concepts](/guide/concepts)
and [runner comparisons](/guide/runners).

## A related-files query returns too many tests

Inspect `hasUnfollowedDependencies` and `dependency-not-followed`. Tests with gaps are kept because the changed code
may affect them through an unseen dependency. Shared setup, barrel exports and snapshots can also connect many
tests to one file. Pass changed paths relative to the CLI's current folder; MCP `related` paths are relative to the
server's project root. See [dependency limits](/guide/limits#what-dependencyhash-leaves-out).

## A diff refuses saved scans or warns about hashes

Use complete JSON inventories, without `--fields` or `--format jsonl`. Scan both revisions with the same core version,
framework, root, patterns, filters and case-expansion setting. Different core versions disable hash comparison and
rename matching. Scan errors can make missing tests look removed, so resolve them before drawing that conclusion.
The [diff guide](/guide/diff#hash-compatibility-and-incomplete-scans) describes the warnings.

## The command fails or the MCP server does not start

CLI exit code 2 means invalid arguments, an input or output problem, or an unexpected failure. Read standard error;
check the Node.js requirement, paths and write permissions. Exit code 0 with diagnostics is a different outcome.

For MCP, inspect the client's server status and logs, confirm its project root and call `test_summary` first. The
[server README](https://github.com/Huldoser/test-inventory-mcp#troubleshooting) covers setup and tool-call failures.

## Report a scan problem

Include the core version, command or tool arguments, expected result, diagnostic and a small test file that reproduces
the issue. Remove private project data before attaching files. Use the
[scan issue form](https://github.com/Huldoser/test-inventory/issues/new?template=scan-reads-test-wrong.yml).
Report vulnerabilities privately through the [security policy](https://github.com/Huldoser/test-inventory/blob/main/SECURITY.md).
