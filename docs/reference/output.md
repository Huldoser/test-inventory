# Output

A scan returns one JSON object. Its [JSON Schema](https://huldoser.github.io/test-inventory/schema/v1.json) is
published with each release.

<!-- output: trading-web -->

```json
{
  "schemaVersion": 1,
  "tool": { "name": "test-inventory", "version": "0.1.0" },
  "framework": "playwright",
  "frameworkVersion": "1.63.0",
  "summary": { "fileCount": 11, "testCount": 31 },
  "suites": [],
  "tests": [],
  "diagnostics": []
}
```

## Rules for every key

- Every key is always present, in every record, for both frameworks. Nothing is `undefined` or left out.
- A boolean that cannot be true in a framework is `false`: `isFixme` in Vitest, `isShuffled` in Playwright.
- A list with nothing in it is `[]`.
- A value that does not exist or could not be worked out is `null`.
- Two scans of the same code give the same output, byte for byte. There is no timestamp.
- Paths are relative to the project root and use `/` on every system.
- Lines and columns start at 1. A line ends at `\n`, `\r\n` or `\r`, and columns count UTF-16 code units, as editors do.

In the TypeScript declarations on this page, ids and hashes are a `Hash`, lines and columns a `Position`, and counts a
`Count`:

::: details Hash, Position and Count

<!-- types: Hash, Position, Count -->

:::

## Top level

| Key                | Type           | Meaning                                                                                                            |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion`    | `1`            | The version of this format. See [versioning](#versioning).                                                         |
| `tool`             | object         | `name` is `test-inventory`; `version` is the version that produced the output.                                     |
| `framework`        | string         | `playwright` or `vitest`, as given to the scan.                                                                    |
| `frameworkVersion` | string or null | Read from the project, or given with `--framework-version`. See [framework version](/guide/cli#framework-version). |
| `summary`          | object         | Counts over the whole scan.                                                                                        |
| `suites`           | array          | One record per describe.                                                                                           |
| `tests`            | array          | One record per test declaration.                                                                                   |
| `diagnostics`      | array          | What the scan could not read, or read only in part.                                                                |

::: details TypeScript

<!-- types: Inventory, Tool, Framework -->

:::

## Tests

A test record holds the values the runner applies to the test, including those it inherits from the describes and
the file around it.

| Key                                                                             | Type           | Meaning                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                            | string         | 16 hex characters from the file path, the describe titles and title without tags, and the position among tests with the same title. It stays the same when the test moves to another line.                                                                                                                                             |
| `bodyHash`                                                                      | string or null | 16 hex characters from the test function's syntax tree, so formatting, comments, quote style, semicolons, trailing commas and line endings don't change it. For a function passed by name, the hash of that function when it is declared in the file. `null` without a function. Trivial bodies such as `async () => {}` share a hash. |
| `suiteId`                                                                       | string or null | The nearest describe. `null` outside any describe.                                                                                                                                                                                                                                                                                     |
| `suitePath`                                                                     | string[]       | Titles of the describes around the test, outermost first.                                                                                                                                                                                                                                                                              |
| `relativeFilePath`                                                              | string         | The file, from the project root.                                                                                                                                                                                                                                                                                                       |
| `fileName`                                                                      | string         | The file name without folders.                                                                                                                                                                                                                                                                                                         |
| `lineStart`, `lineEnd`                                                          | number         | First and last line of the test call.                                                                                                                                                                                                                                                                                                  |
| `columnStart`, `columnEnd`                                                      | number         | Where the test call starts, and the column just after its last character.                                                                                                                                                                                                                                                              |
| `title`                                                                         | string         | The title as the runner shows it, tags included.                                                                                                                                                                                                                                                                                       |
| `titleWithoutTags`                                                              | string         | Playwright: the title without its `@tag` words. Vitest: the title.                                                                                                                                                                                                                                                                     |
| `hasDynamicTitle`                                                               | boolean        | The title could not be worked out; `title` holds its source text.                                                                                                                                                                                                                                                                      |
| `fullName`                                                                      | string         | `suitePath` and `title` joined with `>`.                                                                                                                                                                                                                                                                                               |
| `isTypeTest`                                                                    | boolean        | Declared in a Vitest type test file, `*.test-d.ts` or `*.spec-d.ts`.                                                                                                                                                                                                                                                                   |
| `state`                                                                         | string         | `active`, `skip`, `fixme`, `todo`, `expectedToFail` or `notLoaded`.                                                                                                                                                                                                                                                                    |
| `isActive`, `isSkipped`, `isFixme`, `isTodo`, `isExpectedToFail`, `isNotLoaded` | boolean        | Exactly one is true, matching `state`.                                                                                                                                                                                                                                                                                                 |
| `isOnly`                                                                        | boolean        | The test or a describe around it uses `.only`.                                                                                                                                                                                                                                                                                         |
| `isConditional`                                                                 | boolean        | The state applies only when a condition holds.                                                                                                                                                                                                                                                                                         |
| `condition`                                                                     | string or null | The condition's source text, on one line and cut at 200 characters.                                                                                                                                                                                                                                                                    |
| `reason`                                                                        | string or null | The reason given with the state.                                                                                                                                                                                                                                                                                                       |
| `hasDynamicReason`                                                              | boolean        | The reason could not be worked out to a string; `reason` holds its source text.                                                                                                                                                                                                                                                        |
| `stateSource`                                                                   | string or null | Where the state is set: `test`, `suite` or `file`. `null` for active tests.                                                                                                                                                                                                                                                            |
| `stateLine`                                                                     | number or null | The line that sets the state. `null` for active tests.                                                                                                                                                                                                                                                                                 |
| `isParallel`, `isSerial`                                                        | boolean        | The mode set in the file. Both `false` means the framework's default.                                                                                                                                                                                                                                                                  |
| `tags`                                                                          | string[]       | Tags of the test and every describe around it, outermost first, without duplicates.                                                                                                                                                                                                                                                    |
| `annotations`                                                                   | object[]       | `{ type, description, lineStart }` from Playwright's `annotation` option and `test.info().annotations.push()`.                                                                                                                                                                                                                         |
| `comments`                                                                      | string[]       | The comment lines directly above the test, without lint, compiler, formatter and coverage directives. By default only for tests that are not active.                                                                                                                                                                                   |
| `locks`                                                                         | string[]       | Playwright `lock` names on the test and its describes (1.63), and from `test.describe.configure()` in the file and those describes (1.64).                                                                                                                                                                                             |
| `meta`                                                                          | object or null | Vitest `meta`, merged from the describes and the test, literal values only.                                                                                                                                                                                                                                                            |
| `isParameterized`                                                               | boolean        | Declared with `.each` or `.for`, or inside a `describe.each` or `describe.for`, so the runner repeats it.                                                                                                                                                                                                                              |
| `caseCount`                                                                     | number or null | How many times the runner repeats the test: its own cases times those of each describe table around it. `null` when a table is not written out in the file, or the test is not parameterized.                                                                                                                                          |
| `isInLoop`                                                                      | boolean        | Declared inside a loop, `forEach` or `map`.                                                                                                                                                                                                                                                                                            |
| `isInCondition`                                                                 | boolean        | Declared inside `if`, `?:`, `&&`, `\|\|`, `??` or `switch`.                                                                                                                                                                                                                                                                            |
| `isInFunction`                                                                  | boolean        | Declared inside a plain function. When calls of the function would place it elsewhere, a `test-in-function` warning says so.                                                                                                                                                                                                           |

::: details TypeScript

<!-- types: TestRecord, TestState, StateSource, Annotation, MetaValue -->

:::

### How the state is chosen

The state is the one the runner applies. The test's own skip, fixme or todo comes first: `test.fixme()` in a skipped
describe stays `fixme`. Then the describes around it from the innermost out, then the file. A state that always
applies wins over one that only applies under a condition, and an unconditional skip, fixme or todo around a test wins
over the test's own expected failure, as neither runner runs that test. `stateSource` says where the chosen state was
set.

In Vitest, `.only` wins over `.skip`, which wins over `.todo`, within one declaration: `test.only.skip` is active.

A `test.skip()`, `test.fixme()`, `test.fail()` or `test.describe.configure()` call inside a plain function in the file
applies where the function is called: to a test that calls it in its body, to the tests a hook covers when a hook calls
it, or to a describe when it is called directly in the describe's body. The conditions around the call and inside the
function are joined, and `stateLine` is the line of the call inside the function. Calls through other functions in the
file are followed too. A function that is exported, or that nothing in the file calls, changes no record and gets a
`state-in-helper` warning.

When a file has a problem that makes the runner refuse to load it, such as a Playwright test without a body or a
Vitest call to an API that the version removed, every
test in it is `notLoaded`: `stateSource` is `file`, `stateLine` is the line of the first such problem, and
`condition` and `reason` are `null`. The [diagnostic](/reference/diagnostics#files-the-runner-refuses-to-load) says
why. Everything else about the tests stays as written, so fixing the file brings their states back.

## Suites

A suite record describes what is written on the describe itself. Values a test inherits from it are in the test
record.

| Key                                                                                | Type                   | Meaning                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `parentId`                                                                   | string, string or null | The describe and the one around it.                                                                                                                                            |
| `bodyHash`                                                                         | string or null         | The describe's own code: hooks, `test.use()`, `describe.configure()` and helpers, without the tests and describes inside it, hashed as for tests. `null` when nothing is left. |
| `relativeFilePath`, `fileName`, `lineStart`, `lineEnd`, `columnStart`, `columnEnd` |                        | As for tests.                                                                                                                                                                  |
| `title`, `titleWithoutTags`, `hasDynamicTitle`                                     |                        | As for tests. An anonymous Playwright describe has an empty title and is left out of paths.                                                                                    |
| `path`                                                                             | string[]               | The titles of this describe and those around it.                                                                                                                               |
| `isSkipped`, `isFixme`, `isTodo`, `isExpectedToFail`, `isOnly`                     | boolean                | Set on this describe. `isExpectedToFail` is a Playwright `test.fail()` in the describe's body.                                                                                 |
| `isConditional`, `condition`, `reason`, `hasDynamicReason`                         |                        | As for tests.                                                                                                                                                                  |
| `isParallel`, `isSerial`, `isShuffled`                                             | boolean                | The mode set on this describe.                                                                                                                                                 |
| `isParameterized`                                                                  | boolean                | `describe.each` or `describe.for`.                                                                                                                                             |
| `tags`, `annotations`, `locks`, `meta`                                             |                        | Written on this describe.                                                                                                                                                      |

::: details TypeScript

<!-- types: SuiteRecord -->

:::

## Summary

Each count uses the same definition as the matching key: `skipCount` counts tests with `isSkipped: true`.

`fileCount`, `suiteCount`, `testCount`, `activeCount`, `skipCount`, `fixmeCount`, `todoCount`,
`expectedToFailCount`, `notLoadedCount`, `onlyCount`, `conditionalCount`, `parallelCount`, `serialCount`,
`parameterizedCount`, `inLoopCount`, `inConditionCount`, `inFunctionCount`, `typeTestCount`, `diagnosticCount`.

`tagCounts` maps each tag to the number of tests with it. `annotationCounts` maps each annotation type to the number
of tests with at least one annotation of that type. Both are sorted by name.

::: details TypeScript

<!-- types: Summary -->

:::

## Diagnostics

| Key                        | Type           | Meaning                                                                              |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `code`                     | string         | One of the [diagnostic codes](/reference/diagnostics).                               |
| `level`                    | string         | `error` when tests may be missing; `warning` when a value is missing or approximate. |
| `message`                  | string         | One sentence about the problem.                                                      |
| `relativeFilePath`         | string         | The file.                                                                            |
| `lineStart`, `columnStart` | number or null | Where the problem is. `null` for the whole file.                                     |
| `testId`                   | string or null | The test it concerns.                                                                |
| `source`                   | string or null | The code involved, cut at 200 characters.                                            |

::: details TypeScript

<!-- types: Diagnostic, DiagnosticLevel, DiagnosticCode -->

:::

## Versioning

- The package follows semantic versioning. Before 1.0, a breaking change comes in a minor release.
- Adding a key, a diagnostic code or a value to an open set keeps `schemaVersion`. Read the output in a way that
  ignores keys you don't know; the published schema allows them.
- These sets are open, so a reader should expect values it doesn't know yet: `framework`, `state`, `stateSource` and
  the diagnostic `code`. The published schema lists the known values and accepts any string.
- Removing or renaming a key, or changing its type or meaning, raises `schemaVersion` by one and is a breaking release.
- Each `schemaVersion` has its own schema file, shipped in the package as `test-inventory/schema/v1.json` and
  published on this site.
- A key that is going away is marked deprecated in these pages and in the schema for at least one minor release first.
