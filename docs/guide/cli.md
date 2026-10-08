# Command line

```sh
test-inventory <glob...> --framework <playwright|vitest> [options]
```

The globs select the test files, relative to `--root`. Quote them so the shell passes them on unchanged.
`node_modules` folders are always left out. On Windows a `\` in a glob separates folders, so `tests\**\*.spec.ts`
works; on Linux and macOS it escapes the next character, as in `tests/\[legacy\]/*.spec.ts`. A `/` separates
folders on every system.

| Option                        | Meaning                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `--framework <name>`          | `playwright` or `vitest`. Required. One run reads one framework.                                    |
| `--root <dir>`                | The project root. Paths in the output are relative to it. Default: the current folder.              |
| `--ignore <glob>`             | Leave out matching files. Can be given more than once.                                              |
| `--framework-version <x.y.z>` | Apply the rules of this version instead of the one read from the project.                           |
| `--comments <mode>`           | Which tests get the comment lines above them: `all`, `non-active` or `none`. Default: `non-active`. |
| `-o, --output <file>`         | Write the JSON to a file instead of standard output. The file is replaced only once it is complete. |
| `--pretty`                    | Indent the JSON with two spaces. Without it the JSON is on one line.                                |
| `-h, --help`                  | Show the help.                                                                                      |
| `-v, --version`               | Show the version.                                                                                   |

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
rule can read it, for example with `jq`:

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright \
  | jq -e '.summary.onlyCount == 0' > /dev/null
```

## Framework version

Some syntax depends on the framework version: `test.fail.only` needs Playwright 1.49, the `lock` option 1.63, and
Vitest 5 removed `describe.sequential`. The version is read from the project, in this order:

1. `node_modules/@playwright/test/package.json` or `node_modules/vitest/package.json`.
2. `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` or `bun.lock`.
3. The version in `package.json`.

Each is looked for in the root, then in each folder above it, as a package in a monorepo may be installed or locked
at the top. `--framework-version` overrides all of them. The version ends up in `frameworkVersion` in the output.

When `package.json` gives only a range, such as `^4.0.0`, `frameworkVersion` is the lowest version in it, the rules of
the newest release in that major apply, and an `approximate-framework-version` warning names the range and the file.
When nothing is found, `frameworkVersion` is `null`, the rules of the newest supported version apply, and an
`unknown-framework-version` warning says so.

## Large suites

Files are read one at a time and their syntax trees are dropped before the next file, and the JSON is written one
record at a time. Memory grows with the number of records, not with the size of the files.
