---
description: The test-inventory command, its options and exit codes, and how it finds the framework version.
---

# Command line

```sh
test-inventory [glob...] --framework <playwright|vitest> [options]
```

The globs select the test files, relative to `--root`. Quote them so the shell passes them on unchanged. Without
globs, the test files are those the Playwright or Vitest configs in the root and the folders below it run, each with
the config it uses; see [configs](/reference/output#configs).
`node_modules` and `.git` folders are always left out. As in Playwright and Vitest, globs match folders and files
whose names start with a dot, as in `.storybook/`. On Windows a `\` in a glob separates folders, so `tests\**\*.spec.ts`
works; on Linux and macOS it escapes the next character, as in `tests/\[legacy\]/*.spec.ts`. A `/` separates
folders on every system.

| Option                        | Meaning                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--framework <name>`          | `playwright` or `vitest`. Required. One run reads one framework.                                                                                                                          |
| `--root <dir>`                | The project root. Paths in the output are relative to it. Default: the current folder.                                                                                                    |
| `--ignore <glob>`             | Leave out matching files. Can be given more than once.                                                                                                                                    |
| `--framework-version <x.y.z>` | Apply the rules of this version instead of the one read from the project.                                                                                                                 |
| `--comments <mode>`           | Which tests get the comment lines above them: `all`, `non-active` or `none`. Default: `non-active`.                                                                                       |
| `--state <state>`             | Keep tests in this state, such as `skip` or `fixme`. Can be given more than once.                                                                                                         |
| `--tag <tag>`                 | Keep tests with this tag, as the output writes it, such as `@smoke`. Can be given more than once.                                                                                         |
| `--grep <regex>`              | Keep tests whose `fullName` matches the regular expression, ignoring case.                                                                                                                |
| `--only`                      | Keep tests that use `.only`, or are inside a describe that does.                                                                                                                          |
| `--without-reason`            | Keep tests that don't run and give no reason.                                                                                                                                             |
| `--related <file>`            | Keep tests a change to this file can affect; see [Tests a change can affect](#tests-a-change-can-affect). Can be given more than once; `-` reads files from standard input, one per line. |
| `--fields <keys>`             | Write only these keys of each test, separated by commas. `id` is always kept.                                                                                                             |
| `--format <format>`           | `json`, or `jsonl` for one record per line. Default: `json`.                                                                                                                              |
| `-o, --output <file>`         | Write the JSON to a file instead of standard output. The file is replaced only once it is complete.                                                                                       |
| `--pretty`                    | Indent the JSON with two spaces. Without it the JSON is on one line.                                                                                                                      |
| `-h, --help`                  | Show the help.                                                                                                                                                                            |
| `-v, --version`               | Show the version.                                                                                                                                                                         |

## Filters

The filters answer a question about a few tests without reading the whole inventory. A test is kept when it passes
every filter given; a filter given more than once keeps a test that has any of its values. To list the tests in the
web app that are skipped or marked fixme, with their reasons:

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --state skip --state fixme --fields fullName,reason
```

Each test then has only `id` and the keys asked for:

<!-- output: trading-web -->

```json
{
  "id": "da2f5749ba9ab068",
  "fullName": "orders > limit orders > rejects a limit price far from the last trade",
  "reason": "confirm dialog stays open on WebKit"
}
```

The rest of the output describes the tests that were kept: `files` has their files, `suites` the describes around
them, `diagnostics` their problems and the ones that are not about a single test, and `summary` counts them. Files
and diagnostics whose tests were all left out are dropped too, but a file without tests stays with its errors, since
tests may be missing from the answer. `summary.fileCount` is still the number of files scanned, and each file's
`suiteCount` and `testCount` still count the whole file.

Output written with `--fields` leaves keys out of the test records, so it no longer matches the
[JSON Schema](/reference/output#versioning), which requires every key. Without `--fields`, filtered output matches it.

To keep only some files, give a narrower glob instead: the files left out are not read at all.

## Tests a change can affect

`--related` keeps the tests a change to a file can affect: those whose
[`dependencies`](/reference/output#tests) include it, which covers the tests themselves, the code, fixtures, test data,
configs, setup files and snapshots they use, and the tests that reach code the scan can't follow, which a change may
affect unseen. To list the web app's tests that use the orders blotter page object:

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --related pages/orders-blotter.ts --fields fullName
```

`--related -` reads the files from standard input, one per line, so the files a pull request changes can be piped in
from git. Paths are taken from the current folder, as git writes them when run from the root of the repository, also
when `--root` is a folder in it:

```sh
git diff --name-only origin/main... | npx test-inventory --framework playwright --related -
```

The scan reads the files as they are, so a deleted file is in no test's `dependencies`; the tests that imported it reach
a file that can't be read, and are kept. Installed packages aren't followed: a lockfile change keeps no test.

## JSON Lines

`--format jsonl` writes the same inventory with one record on each line, which `grep`, `jq -c` and tools that read
newline-delimited JSON, such as DuckDB, take one line at a time. Each line has a `type` key; the
[output reference](/reference/output#json-lines) lists the line types.

## Exit codes

| Code | When                                                                              |
| ---- | --------------------------------------------------------------------------------- |
| 0    | The scan finished. Diagnostics are part of the output, not failures.              |
| 1    | Reserved for a future release.                                                    |
| 2    | The arguments were invalid, the output could not be written, or the scan crashed. |

These are the exit codes ESLint uses. A reader that stops early, as `| head` does, is not an error: the output ends
there and the code is 0. Globs that match no files are not an error either: the output is an empty inventory with a
`no-files-matched` warning, and one line on standard error says so.

There are no options to fail a build on skipped tests or on diagnostics. The output is data; a check that needs a
rule can read it, for example with Node.js:

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
node -e "if (require('./inventory.json').summary.onlyCount > 0) process.exit(1)"
```

## Framework version

Some syntax depends on the framework version: `test.fail.only` needs Playwright 1.49, the `lock` option 1.63, and
Vitest 5 removed `describe.sequential`. The version is read from the project, in this order:

1. `node_modules/@playwright/test/package.json` or `node_modules/vitest/package.json`.
2. `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` or `bun.lock`.
3. The version in `package.json`.

Each is looked for in the root, then in each folder above it, as a package in a monorepo may be installed or locked
at the top. When none of them has the framework, as in a monorepo whose root leaves it to a package such as `code/`,
the shallowest `package.json` below the root that declares it and holds scanned files is used instead, outside
`node_modules`, and its folder is read in the same order. `--framework-version` overrides all of them. The version
ends up in `frameworkVersion` in the output.

When `package.json` gives only a range, such as `^4.0.0`, `frameworkVersion` is the lowest version in it, the rules of
the newest release in that major apply, and an `approximate-framework-version` warning names the range and the file.
When nothing is found, `frameworkVersion` is `null`, the rules of the newest supported version apply, and an
`unknown-framework-version` warning says so.

## Large suites

Files are read one at a time and their syntax trees are dropped before the next file, and the JSON is written one
record at a time. Memory grows with the number of records, not with the size of the files.
