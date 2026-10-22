---
description: Every key of the JSON output for tests, suites, the summary and diagnostics, and how it is versioned.
---

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

- Every key is always present, in every record, for both frameworks. Nothing is `undefined` or left out. The one
  exception is asked for: `--fields` keeps only the named keys of each test.
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
| `files`            | array          | One record per scanned file.                                                                                       |
| `suites`           | array          | One record per describe.                                                                                           |
| `tests`            | array          | One record per test declaration.                                                                                   |
| `diagnostics`      | array          | What the scan could not read, or read only in part.                                                                |

::: details TypeScript

<!-- types: Inventory, Tool, Framework -->

:::

## Tests

A test record holds the values the runner applies to the test, including those it inherits from the describes and
the file around it.

| Key                                                                             | Type                           | Meaning                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                            | string                         | 16 hex characters from the file path, the describe titles and title without tags, and the position among tests with the same title. It stays the same when the test moves to another line.                                                                                                                                             |
| `bodyHash`                                                                      | string or null                 | 16 hex characters from the test function's syntax tree, so formatting, comments, quote style, semicolons, trailing commas and line endings don't change it. For a function passed by name, the hash of that function when it is declared in the file. `null` without a function. Trivial bodies such as `async () => {}` share a hash. |
| `suiteId`                                                                       | string or null                 | The nearest describe. `null` outside any describe.                                                                                                                                                                                                                                                                                     |
| `suitePath`                                                                     | string[]                       | Titles of the describes around the test, outermost first.                                                                                                                                                                                                                                                                              |
| `relativeFilePath`                                                              | string                         | The file, from the project root.                                                                                                                                                                                                                                                                                                       |
| `fileName`                                                                      | string                         | The file name without folders.                                                                                                                                                                                                                                                                                                         |
| `lineStart`, `lineEnd`                                                          | number                         | First and last line of the test call.                                                                                                                                                                                                                                                                                                  |
| `columnStart`, `columnEnd`                                                      | number                         | Where the test call starts, and the column just after its last character.                                                                                                                                                                                                                                                              |
| `declaredAt`                                                                    | object or null                 | `{ relativeFilePath, lineStart, columnStart }` of the test in a helper imported from another file, when that helper declares it. The record's own location is then the call in this file that registers the test. `null` for tests written in the file.                                                                                |
| `title`                                                                         | string                         | The title as the runner shows it, tags included.                                                                                                                                                                                                                                                                                       |
| `titleWithoutTags`                                                              | string                         | Playwright: the title without its `@tag` words. Vitest: the title.                                                                                                                                                                                                                                                                     |
| `hasDynamicTitle`                                                               | boolean                        | The title could not be worked out; `title` holds its source text.                                                                                                                                                                                                                                                                      |
| `fullName`                                                                      | string                         | `suitePath` and `title` joined with `>`.                                                                                                                                                                                                                                                                                               |
| `isTypeTest`                                                                    | boolean                        | Declared in a Vitest type test file, `*.test-d.ts` or `*.spec-d.ts`.                                                                                                                                                                                                                                                                   |
| `state`                                                                         | string                         | `active`, `skip`, `fixme`, `todo`, `expectedToFail` or `notLoaded`.                                                                                                                                                                                                                                                                    |
| `isActive`, `isSkipped`, `isFixme`, `isTodo`, `isExpectedToFail`, `isNotLoaded` | boolean                        | Exactly one is true, matching `state`.                                                                                                                                                                                                                                                                                                 |
| `isOnly`                                                                        | boolean                        | The test or a describe around it uses `.only`.                                                                                                                                                                                                                                                                                         |
| `isConditional`                                                                 | boolean                        | The state applies only when a condition holds.                                                                                                                                                                                                                                                                                         |
| `condition`                                                                     | string or null                 | The condition's source text, on one line and cut at 200 characters.                                                                                                                                                                                                                                                                    |
| `reason`                                                                        | string or null                 | The reason given with the state.                                                                                                                                                                                                                                                                                                       |
| `hasDynamicReason`                                                              | boolean                        | The reason could not be worked out to a string; `reason` holds its source text.                                                                                                                                                                                                                                                        |
| `stateSource`                                                                   | string or null                 | Where the state is set: `test`, `suite` or `file`. `null` for active tests.                                                                                                                                                                                                                                                            |
| `stateLine`                                                                     | number or null                 | The line that sets the state. `null` for active tests.                                                                                                                                                                                                                                                                                 |
| `isParallel`, `isSerial`                                                        | boolean                        | The mode set in the file. Both `false` means the framework's default.                                                                                                                                                                                                                                                                  |
| `tags`                                                                          | string[]                       | Tags of the test and every describe around it, outermost first, without duplicates.                                                                                                                                                                                                                                                    |
| `annotations`                                                                   | object[]                       | `{ type, description, lineStart }` from Playwright's `annotation` option and `test.info().annotations.push()`.                                                                                                                                                                                                                         |
| `comments`                                                                      | string[]                       | The comment lines directly above the test, without lint, compiler, formatter and coverage directives. By default only for tests that are not active.                                                                                                                                                                                   |
| `locks`                                                                         | string[]                       | Playwright `lock` names on the test and its describes (1.63), and from `test.describe.configure()` in the file and those describes (1.64).                                                                                                                                                                                             |
| `meta`                                                                          | object or null                 | Vitest `meta`, merged from the describes and the test, literal values only.                                                                                                                                                                                                                                                            |
| `hooks`                                                                         | object                         | Every hook that runs around the test: those at the top of the file and in each describe around it, by kind. See [files](#files).                                                                                                                                                                                                       |
| `timeout`                                                                       | number or null                 | In milliseconds. See [run settings](#run-settings). `null` when the file sets none, so the config's timeout applies.                                                                                                                                                                                                                   |
| `isSlow`, `slowCondition`                                                       | boolean, string or null        | Playwright `test.slow()` applies, and its condition's source text; `null` when it always applies.                                                                                                                                                                                                                                      |
| `retries`                                                                       | number or null                 | How many times the runner retries the test when it fails. `null` when the file sets none.                                                                                                                                                                                                                                              |
| `retryDelay`, `retryCondition`                                                  | number or null, string or null | Vitest's `retry` object (4.1): the milliseconds between retries, and the source text of its `condition`.                                                                                                                                                                                                                               |
| `repeats`                                                                       | number or null                 | Vitest `repeats`: how many times the runner runs the test again after the first run.                                                                                                                                                                                                                                                   |
| `fixtures`                                                                      | string[]                       | The names the test function takes from its context, then those of the `beforeEach`, `afterEach` and `aroundEach` hooks around it, once each. Vitest's own context keys, such as `expect`, `task` and `annotate`, are left out. See [what the body does](#what-the-body-does).                                                          |
| `expectCount`                                                                   | number                         | The `expect()`, `expect.soft()` and `expect.poll()` calls written in the body.                                                                                                                                                                                                                                                         |
| `expectedAssertions`, `expectsAssertions`                                       | number or null, boolean        | Vitest's `expect.assertions(n)` and `expect.hasAssertions()` in the body.                                                                                                                                                                                                                                                              |
| `hasEmptyBody`                                                                  | boolean                        | The test function has no statements, comments aside.                                                                                                                                                                                                                                                                                   |
| `steps`                                                                         | object[]                       | `{ title, hasDynamicTitle, lineStart, depth, isSkipped }` for each Playwright `test.step()` and `test.step.skip()` in the body, in source order; `depth` is 0 for a step directly in the test.                                                                                                                                         |
| `isBenchmark`                                                                   | boolean                        | A Vitest 5 benchmark: in a file such as `*.bench.ts`, or using the `bench` fixture. Plain `vitest` doesn't run it; `vitest bench` does.                                                                                                                                                                                                |
| `isParameterized`                                                               | boolean                        | Declared with `.each` or `.for`, or inside a `describe.each` or `describe.for`, so the runner repeats it.                                                                                                                                                                                                                              |
| `caseCount`                                                                     | number or null                 | How many times the runner repeats the test: its own cases times those of each describe table around it. `null` when a table is not written out in the file, or the test is not parameterized.                                                                                                                                          |
| `isInLoop`                                                                      | boolean                        | Declared inside a loop, `forEach` or `map`.                                                                                                                                                                                                                                                                                            |
| `isInCondition`                                                                 | boolean                        | Declared inside `if`, `?:`, `&&`, `\|\|`, `??`, `switch` or a `catch` block.                                                                                                                                                                                                                                                           |
| `isInFunction`                                                                  | boolean                        | Declared inside a plain function. A function called from the file or a describe has its tests recorded at each call; one the scan can't place gets a `test-in-function` warning.                                                                                                                                                       |

::: details TypeScript

<!-- types: TestRecord, TestState, StateSource, Annotation, Step, MetaValue -->

:::

### How the state is chosen

The state is the one the runner applies. The test's own skip, fixme or todo comes first: `test.fixme()` in a skipped
describe stays `fixme`. Then the describes around it from the innermost out, then the file. A state that always
applies wins over one that only applies under a condition, and an unconditional skip, fixme or todo around a test wins
over the test's own expected failure, as neither runner runs that test. For the same reason it wins over an
unconditional skip in a test or hook body: in a fixme or todo describe, the test keeps that state. `stateSource` says
where the chosen state was set.

In Vitest, `.only` wins over `.skip`, which wins over `.todo`, within one declaration: `test.only.skip` is active. A
test's options win over its chain, so `test.skip('title', { skip: false }, fn)` runs, while a describe's chain wins
over its options, and so does a test's for its mode. A describe passes its `skip` option down to the tests and
describes inside, where it wins over todo: `test.todo()` in `describe('title', { skip: true }, fn)` is skipped. It does
so also when the describe's own `.only` keeps the describe from being skipped.

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
why. Everything else about the tests stays as written, so fixing the file brings their states back. A refused call
that declares a test or describe is listed without the part that fails, so its tests are `notLoaded` too.

### Run settings

The run settings are those written in the file. Each key comes from the nearest place that sets it:

1. Calls in the test body, the last one winning: Playwright's `test.setTimeout()` and `test.slow()`.
2. The same calls in a `beforeEach` around the test, which runs before the body. In `beforeAll` and `afterAll` they
   set the hook's own timeout, and an `afterEach` runs after the body, so those are left out.
3. The test's own options: Vitest's `timeout`, `retry` and `repeats`, or a timeout after the body, as in
   `test(title, fn, 30_000)`.
4. Each describe around the test, from the innermost out, and then the file: Playwright's
   `test.describe.configure({ timeout, retries })`, `test.setTimeout()` and `test.slow()` written in the describe, and
   the options Vitest passes down from `describe()`.

A Vitest `retry` replaces the whole `retry` around it, so a test with `retry: 1` in a describe with a `delay` has no
`retryDelay`. Vitest reads the `retry` object from 4.1 and ignores it before, and so does the scan.

Playwright triples the timeout of a slow test once, when `test.slow()` runs; a `test.setTimeout()` after it replaces
the tripled value. The record keeps `timeout` as written and `isSlow` beside it. `test.slow()` under a condition, or
inside `if`, gives `slowCondition`. A timeout set only under a condition, or one the scan can't work out, such as a
constant imported from another file, is left out with an `unresolved-option` warning, and the value around it applies.

In the web app, the live price stream retries its tests, since the demo feed drops connections now and then:

<!-- code: trading-web/tests/price-stream.spec.ts -->

```ts
test.describe('live price stream', () => {
  // The demo feed drops connections now and then.
  test.describe.configure({ retries: 2 });
  // ...
});
```

<!-- output: trading-web -->

```json
{
  "fullName": "live price stream > updates prices without a reload",
  "timeout": null,
  "isSlow": false,
  "retries": 2,
  "retryDelay": null,
  "repeats": null
}
```

### What the body does

These keys come from the test function itself, not from the functions it calls: an `expect()` or a `test.step()` in a
page object or a helper isn't counted. Each call is counted once as written, also inside a loop. Vitest's
`annotate(message, type?)` from the test context (3.2) adds an annotation, of type `notice` when no type is given.

In the web app, the order lifecycle enters and confirms the order in two steps:

<!-- code: trading-web/tests/orders/order-lifecycle.spec.ts -->

```ts
test('places a limit order for 100 NVDA', async ({ orderTicket, blotter }) => {
  await test.step('enter the order', async () => {
    await orderTicket.open('NVDA');
    await orderTicket.buy({ quantity: 100, limitPrice: 118 });
  });
  await test.step('confirm it', async () => {
    await orderTicket.confirm();
  });
  await expect(blotter.status('NVDA')).toHaveText('Working');
});
```

<!-- output: trading-web -->

```json
{
  "fullName": "order lifecycle > places a limit order for 100 NVDA",
  "fixtures": ["orderTicket", "blotter"],
  "expectCount": 1,
  "hasEmptyBody": false,
  "steps": [
    { "title": "enter the order", "hasDynamicTitle": false, "lineStart": 8, "depth": 0, "isSkipped": false },
    { "title": "confirm it", "hasDynamicTitle": false, "lineStart": 12, "depth": 0, "isSkipped": false }
  ]
}
```

## Suites

A suite record describes what is written on the describe itself. Values a test inherits from it are in the test
record.

| Key                                                                                              | Type                   | Meaning                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `parentId`                                                                                 | string, string or null | The describe and the one around it.                                                                                                                                            |
| `bodyHash`                                                                                       | string or null         | The describe's own code: hooks, `test.use()`, `describe.configure()` and helpers, without the tests and describes inside it, hashed as for tests. `null` when nothing is left. |
| `relativeFilePath`, `fileName`, `lineStart`, `lineEnd`, `columnStart`, `columnEnd`, `declaredAt` |                        | As for tests.                                                                                                                                                                  |
| `title`, `titleWithoutTags`, `hasDynamicTitle`                                                   |                        | As for tests. An anonymous Playwright describe has an empty title and is left out of paths.                                                                                    |
| `path`                                                                                           | string[]               | The titles of this describe and those around it.                                                                                                                               |
| `isSkipped`, `isFixme`, `isTodo`, `isExpectedToFail`, `isOnly`                                   | boolean                | Set on this describe. `isExpectedToFail` is a Playwright `test.fail()` in the describe's body.                                                                                 |
| `isConditional`, `condition`, `reason`, `hasDynamicReason`                                       |                        | As for tests.                                                                                                                                                                  |
| `isParallel`, `isSerial`, `isShuffled`                                                           | boolean                | The mode set on this describe.                                                                                                                                                 |
| `isParameterized`                                                                                | boolean                | `describe.each` or `describe.for`.                                                                                                                                             |
| `tags`, `annotations`, `locks`, `meta`                                                           |                        | Written on this describe.                                                                                                                                                      |
| `hooks`                                                                                          | object                 | The hooks registered directly in this describe, by kind.                                                                                                                       |
| `timeout`, `isSlow`, `slowCondition`, `retries`, `retryDelay`, `retryCondition`, `repeats`       |                        | Set on this describe: by its options, or by `describe.configure()`, `test.setTimeout()` and `test.slow()` in its body.                                                         |

::: details TypeScript

<!-- types: SuiteRecord -->

:::

## Files

A file record is written for every scanned file, also one that has no tests, could not be read or failed to parse.

| Key                            | Type   | Meaning                                                                              |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------ |
| `relativeFilePath`, `fileName` | string | As for tests.                                                                        |
| `hooks`                        | object | The hooks at the top level of the file, which run around every test in it.           |
| `suiteCount`, `testCount`      | number | The describes and tests in the file, all of them also when a filter keeps only some. |

`hooks` counts each kind: `beforeAll`, `beforeEach`, `afterEach` and `afterAll`, and Vitest's `aroundEach` and
`aroundAll` (4.1). A hook in a helper function with a name counts where the helper is called, and not at all when
it is never called; one in a function without a name, such as a callback, counts where it is written. Vitest's `onTestFailed` and `onTestFinished` run inside a test, so they are not counted.
A test's `hooks` adds up those of its file and of each describe around it. In the web app, the price alerts open
their page in a `beforeEach`:

<!-- output: trading-web -->

```json
{
  "id": "006bcf2289191aef",
  "fullName": "price alerts > notifies when the price crosses above the alert",
  "hooks": {
    "beforeAll": 0,
    "beforeEach": 1,
    "afterEach": 0,
    "afterAll": 0,
    "aroundEach": 0,
    "aroundAll": 0
  }
}
```

::: details TypeScript

<!-- types: FileRecord, HookCounts -->

:::

## Summary

Each count uses the same definition as the matching key: `skipCount` counts tests with `isSkipped: true`.

`fileCount`, `suiteCount`, `testCount`, `activeCount`, `skipCount`, `fixmeCount`, `todoCount`,
`expectedToFailCount`, `notLoadedCount`, `onlyCount`, `conditionalCount`, `parallelCount`, `serialCount`,
`parameterizedCount`, `inLoopCount`, `inConditionCount`, `inFunctionCount`, `typeTestCount`, `benchmarkCount`,
`diagnosticCount`.

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

## JSON Lines

With `--format jsonl` the same records are written one per line, each with a `type` key added in front: first an
`inventory` line with the keys of the top level, then a `file`, `suite`, `test` or `diagnostic` line for each record,
in the order of the JSON output, and a `summary` line last. Without its `type`, a line has exactly the keys of the record
described above, and filters and `--fields` work the same way.

<!-- types: InventoryLine -->

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
