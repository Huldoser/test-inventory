# Diagnostics

A diagnostic is part of the output, not a failure: the scan always finishes and exits with 0. Its `level` is `error`
when tests may be missing from the output, and `warning` when a value is missing or approximate.

## Files and imports

| Code                            | Level   | When                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read-error`                    | error   | A test file or a folder could not be read, or a test file is a link to a file that does not exist.                                                                                                                                                                                                                                                                                           |
| `parse-error`                   | error   | The file has a syntax error. When the parser recovers, the tests it read are kept.                                                                                                                                                                                                                                                                                                           |
| `internal-error`                | error   | Reading the file failed unexpectedly. Please report it with the file if you can. The scan goes on with the next file.                                                                                                                                                                                                                                                                        |
| `framework-mismatch`            | error   | The file imports another framework, such as Vitest in a Playwright scan or `@jest/globals` in a Vitest scan.                                                                                                                                                                                                                                                                                 |
| `unresolved-test-import`        | error   | A call shaped like a test, outside any test or hook body, uses a name imported from a module that could not be followed: a missing or broken file, an installed package, or a file that re-exports or builds the test object from another module. The name reads like a test function, as `test` or `checkoutTest` do, or is followed by a member such as `.describe`. The message says why. |
| `invalid-import`                | error   | Vitest imported in a way it does not support: a default import, or `require('vitest')`.                                                                                                                                                                                                                                                                                                      |
| `no-files-matched`              | warning | No test file matches the patterns. The command line also says so on standard error.                                                                                                                                                                                                                                                                                                          |
| `unsupported-file`              | warning | A file that matches the patterns is not JavaScript or TypeScript, so it is not read.                                                                                                                                                                                                                                                                                                         |
| `symlink-ignored`               | warning | A Playwright test file is reached through a symbolic link, which Playwright does not follow.                                                                                                                                                                                                                                                                                                 |
| `local-test-object`             | warning | A variable named like a test object is created by a call the scan cannot follow, as in `const it = await createTester()`. Its calls shaped like tests are read as tests.                                                                                                                                                                                                                     |
| `globals-not-enabled`           | warning | A Vitest file uses `describe`, `it` or `test` without importing them, and no config with `globals: true` was found.                                                                                                                                                                                                                                                                          |
| `unknown-framework-version`     | warning | The framework version could not be read from the project; the newest rules apply.                                                                                                                                                                                                                                                                                                            |
| `approximate-framework-version` | warning | Only a version range was found, such as `^4.0.0` in `package.json`; the rules of the newest release in that major apply.                                                                                                                                                                                                                                                                     |
| `unsupported-framework-version` | warning | The project uses a version older than Playwright 1.42 or Vitest 3.0.                                                                                                                                                                                                                                                                                                                         |

## Declarations

| Code                       | Level                        | When                                                                                                                                                                                       |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invalid-chain`            | error                        | A chain the framework does not have, such as `test.only.skip` in Playwright, or one that needs a newer version.                                                                            |
| `test-without-body`        | error                        | Playwright `test('title')` without a function, which makes Playwright fail to load the file.                                                                                               |
| `describe-not-called`      | error                        | Vitest `describe(fn)` without a title. Vitest never calls the function.                                                                                                                    |
| `async-describe`           | error                        | A Playwright describe callback that awaits. Playwright does not wait for it: tests declared after the first `await` end up in the describe around it, or are not collected at all.         |
| `tag-without-at`           | error                        | A Playwright tag that does not start with `@`, which makes Playwright fail to load the file.                                                                                               |
| `removed-api`              | error                        | An API the framework version removed: Vitest 5 `sequential` and `bench`, or options as the third argument from Vitest 4.                                                                   |
| `duplicate-id`             | error                        | Two records in a file have the same id. Ids include a position among equal titles, so only a hash collision causes this.                                                                   |
| `duplicate-title`          | warning, error in Playwright | Playwright: two tests in the file have the same title path, without anonymous describes, so Playwright fails to load the file. Vitest: two tests in the same describe have the same title. |
| `state-in-helper`          | warning                      | A `test.skip()`, `test.fixme()`, `test.fail()` or `describe.configure()` is in a function that the file exports or never calls, so it is not applied to any record.                        |
| `skip-without-body`        | warning                      | Playwright `test.skip('title')` without a function: Playwright reads the title as a condition and skips every test in the scope.                                                           |
| `nested-test`              | warning                      | A test or describe declared inside a test body or hook. The runner does not collect it, so it is not listed.                                                                               |
| `only-in-skipped-describe` | warning                      | A test with `.only` inside a skipped describe. It is still skipped.                                                                                                                        |

## Values

| Code                      | Level   | When                                                                                                                                                                               |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dynamic-title`           | warning | A title could not be worked out, for example a template with a loop variable. The record uses its source text.                                                                     |
| `dynamic-reason`          | warning | The reason of a skip, fixme or fail could not be worked out to a string. The record uses its source text, with `hasDynamicReason: true`.                                           |
| `unresolved-tag`          | warning | A tag comes from a value that could not be worked out, usually an import. The tag is missing from the record.                                                                      |
| `unresolved-annotation`   | warning | The same for an annotation.                                                                                                                                                        |
| `unresolved-option`       | warning | An options object, a spread in one, a lock, a Vitest flag such as `concurrent` or `only`, or a `meta` value could not be worked out. What it would set is missing from the record. |
| `unresolved-cases`        | warning | The cases of `.each` or `.for` could not be counted; `caseCount` is `null`.                                                                                                        |
| `test-in-loop`            | warning | The test is declared in a loop. It is listed once, while the runner creates one test per iteration.                                                                                |
| `config-may-change-state` | warning | A Vitest file uses tags, and tags defined in the Vitest config can skip tests or change how they run.                                                                              |

## Files the runner refuses to load

Playwright refuses to load a whole file for some problems: `test-without-body`, `tag-without-at`, `invalid-chain`,
and `duplicate-title`. Every test in such a file gets `state: "notLoaded"`, with `stateSource: "file"` and
`stateLine` at the first of these problems. These tests are counted in `notLoadedCount`, not in `activeCount`.
Everything else about them is kept, so the records show what the file declares once the problem is fixed.

Only code that runs while the file loads counts. An `invalid-chain` inside a test, hook or helper body, such as
`test.step.skip()` before Playwright 1.50, runs later and fails only the test that reaches it, so the file loads.

## Example

<!-- output: trading-web -->

```json
{
  "code": "unresolved-tag",
  "level": "warning",
  "message": "Tag value TAGS.risk comes from '../../test-data/tags' and could not be worked out; the tag is missing.",
  "relativeFilePath": "tests/orders/limit-orders.spec.ts",
  "lineStart": 16,
  "columnStart": 48,
  "testId": "74099e2f6d05b9ee",
  "source": "TAGS.risk"
}
```
