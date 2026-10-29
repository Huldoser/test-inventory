---
description: What a scan can't know without running the code, such as config files and imported values.
---

# Known limits

test-inventory reads the code as text and builds a syntax tree. It does not run the code, so a few things the
runner knows at run time are out of its reach. Most limits below show up in the output, as a diagnostic or a key
such as `isInLoop`; each section says when one does not.

## Config files are read only in part

`playwright.config.*` and `vitest.config.*` can change which tests run and how. The scan finds the config each file
uses and lists it in [`configs`](/reference/output#configs), and reads from it which files and projects run each test,
Vitest's `test.globals`, the run settings and modes it gives the tests, Playwright's `forbidOnly`, and the tags Vitest
defines. Other settings, such as `workers`, `use` or setup files, are not read. A test that a project's `grep` leaves
out is still listed, with that project missing from its `projects`.

Which files a config runs is read from the configs in the file's folder and the folders above it. A config elsewhere
that reaches the file, such as `apps/web/playwright.config.ts` with `testDir: '../../e2e'`, is not found from it. A
Vitest 3 project list in `vitest.workspace.*` or `test.workspace` is not read, so the config is taken to run the file.
For a Playwright project's `grep`, a test's text is its project, file, describe and test titles and its tags, as
Playwright builds it, but with every tag given as an option at the end, where Playwright puts a describe's after its
title; only a pattern that depends on that order can tell them apart.

A config is read as code, never run. A setting computed at run time, as from `process.env`, or taken from an
installed package, can't be worked out; when the scan needs it, a `config-value-unknown` warning names it. A config
the runner is pointed to with `--config` is not known from the files, nor a config built by a function the config
calls, such as `getPlaywrightConfig({ startCommand: 'pnpm start' })`.

A run setting the config sets under a condition, as `retries: process.env.CI ? 2 : 0`, is `null` with its source
`config`, since the scan doesn't know where the tests will run; `retriesConfigText` and the other `ConfigText` keys
quote it. When the scan can't work out the tags a Vitest config defines, a file that uses tags gets a
`config-may-change-state` warning, as a tag can skip a test or change how it runs.

Calls that change settings while tests run are not read: `testInfo.setTimeout()` and
`testInfo.slow()`, Vitest's `vi.setConfig()`, and calls in an imported function passed to a hook by name, as in
`test.beforeEach(slowOnCI)` with `slowOnCI` from another file.

`expectCount`, `steps` and `fixtures` read the test function only. Assertions and steps in page objects and helpers,
and fixtures that other fixtures or automatic fixtures set up, are not in them. A test or hook function passed by name
is read when the file declares it, not when it is imported. Vitest's `annotate()` in a hook is not read.

## Imported values are not resolved

Values written in the same file are worked out: string and number literals, constants, enums, arrays and objects
built from them, spreads, string concatenation and template strings. A value imported from another file is not.
When a title, tag, annotation or table comes from an import, the record keeps what it can and a diagnostic names the
module the value came from:

```ts
import { TAGS } from '../../test-data/tags';

test('cancels an open limit order', { tag: TAGS.risk }, async ({ orderTicket }) => {
  // listed without the tag, with an unresolved-tag warning
});
```

Two kinds of import are followed: a custom `test` object, and a function that declares tests, as described under
[tests in helper functions](#tests-in-helper-functions). They are found through:

- a relative path, as in `../fixtures`;
- a path alias from `compilerOptions.paths` or `baseUrl` in the tsconfig nearest the importing file, with every file
  it `extends`, packages such as `@trading/tsconfig` included. Without a `tsconfig.json`, the nearest
  `tsconfig.base.json` is used, as in an Nx workspace; a solution-style tsconfig takes them from the projects it
  `references`;
- an `imports` entry in the nearest `package.json`, as in `#fixtures`;
- a workspace package whose `exports`, `types` or `main` point to TypeScript source, or to build output with the
  source next to it, as `dist/esm/index.js` is to `src/index.ts`: through its link in `node_modules`, or before an
  install, from the `workspaces` of `package.json` and from `pnpm-workspace.yaml`. Patterns and links that lead out of
  the workspace folder are not followed.

A custom `test` object is followed through as many files as it takes: a fixtures file may re-export it, as in
`export * from './base'`, build it with `extend` on a test object it imports from another file, or build it with a
function, written there or imported, as in `export const test = defineDeskTest('equities')`. A fixtures file that
builds its test object with a call the scan can't follow gets the error described below, also when it doesn't import
the framework itself.

Installed packages are not followed. When a call shaped like a test, outside any test or hook body, uses a name from
an import that can't be followed, an `unresolved-test-import` error names the import and says where the chain of
files ends: a file that is missing or can't be parsed, an installed package, or a file that doesn't export a test
object. The tests that use it are missing. The error needs a name that reads like a test function, as in
`brokerTest('routes to NASDAQ', ...)`, or a member such as `.describe` after it. With such a name, a call with a title
and a body counts through any member, as in `it.effect('fills an order', ...)` on a test object that a package
extends, and with a timeout after the body. Helpers shaped the same way, such as `waitForFill('AAPL', (order) => ...)`,
are not reported. `scanSource()` reads no files, so it follows no imports.

## Test objects made by helpers

A function that returns a test object or a describe function is followed when it is declared in the file or imported
from a local file, through the imports above:

```ts
function onNode(major: number) {
  return NODE_MAJOR < major ? it.skip : it;
}

onNode(22)('streams quotes over HTTP/3', async () => {});
```

What it returns may be called in place, as here, or kept in a variable, as in `const quoteTest = onNode(22)`. When the
function returns a different one on different runs, only the modifiers they all have apply, as for a variable chosen
by a condition such as `isCI ? it.skip : it`: this test is listed as `active`, not as a conditional skip. A function
that returns what another such function does is followed too, as in `const fastTest = () => onNode(22)`.

A test object made by a function the scan cannot follow, as from an installed package, is read on trust, with one
`local-test-object` warning per variable or function:

```ts
const test = createBrokerTest({ venue: 'NASDAQ' });

test('fills a market order', async ({ page }) => {});
liveBrokerTest('NYSE')('sends a live order', async ({ page }) => {});
```

This applies only to a variable or function named like a test object (`test`, `it`, `describe`, `suite` or a name
ending in `Test`) whose test object is called with a title and a function, or through a member such as `test.skip`.
Other calls, such as a helper named `expectFill('AAPL', 100, 'filled', check)`, are not tests.

## States set in helper functions

In Playwright, a `test.skip()`, `test.fixme()`, `test.fail()` or `test.describe.configure()` call inside a plain
function applies to the tests, hooks and describes that call that function by name, also through helpers that call
other helpers. A function called from the file or a describe may also be imported from another file:

```ts
function skipWithoutMarketData() {
  test.skip(!process.env.MARKET_DATA_URL, 'needs the market data feed');
}

test('streams AAPL quotes', async ({ page }) => {
  skipWithoutMarketData(); // state: skip, isConditional: true
});
```

When the file exports the function, or nothing in the file calls it by name, the scan can't tell which tests it
affects, and a `state-in-helper` warning says the call was not applied. That includes a function passed as a value,
as in `test.beforeEach(skipWithoutMarketData)`.

## Tests in helper functions

The runner registers a test when the `test()` call runs, in the describe that is being collected at that moment. For
a test declared in a function, that is the describe around each call of the function, not the place where the test
is written. The scan does the same: it reads the function at each call from the file or a describe, with that call's
arguments, so titles built from them are worked out:

```ts
function validatesQuantity(side: string) {
  test(`${side} rejects a zero quantity`, async ({ orderTicket }) => {});
}

test.describe('buy orders', () => {
  validatesQuantity('buy');
});

test.describe.skip('short sells', () => {
  validatesQuantity('short');
});
```

Playwright lists two tests here, and so does the scan: `buy orders > buy rejects a zero quantity`, and
`short sells > short rejects a zero quantity`, which is skipped. Both have `isInFunction: true` and the line of the
`test()` call.

A function imported from another file is followed the same way, through the imports above. Its records give the call
in the scanned file as their location, since that is the line that registers the tests, and `declaredAt` gives the
file and line where the helper writes the test.

Helpers are followed up to 16 calls deep, and at up to 10,000 calls in a file, counting the calls inside helpers; real
suites make far fewer. Past 10,000, a `test-in-function` warning marks the call where the scan stopped.

A `test-in-function` warning remains for tests in a function the scan can't place: one that nothing in the file calls
by name, one the file only exports, and one called only from tests or hooks, where the runner doesn't collect tests.
Such a test is listed where it is written. Tests in a callback passed to another function, as in
`withPaperAccount(() => { test(...) })`, are listed where they are written, with no warning.

## Loops and tables are one record

A test declared in a loop, `forEach` or `map` is listed once, with `isInLoop: true` and a `test-in-loop` warning.
In Playwright, a test in a loop whose title path is the same on each pass is registered twice with the same title, so
Playwright refuses the file: it gets a `duplicate-title` error, and its tests are `notLoaded`.
A `test.each` or `test.for` table is listed once, with `isParameterized: true` and `caseCount` set when the table is
written in the file. The runner creates one test per iteration or per case; expanding them is planned for a later
release.

## Conditions are not evaluated

`test.skip(browserName === 'webkit', 'reason')` gives `state: 'skip'` with `isConditional: true` and the condition's
source text. Whether the test is skipped on a given run depends on the browser, the environment or the clock. A
condition written as a constant, such as `test.skip(true)` or `test.skipIf(false)`, is worked out.

A skip inside `if`, `?:`, `&&`, `||`, `??`, `switch` or a `catch` block runs only when that code does, so it is
conditional too, with the source text of what decides it as its condition. For a `catch` block that is the clause
itself, `catch` or `catch (error)`, since the block runs only when the `try` block throws.

## What dependencyHash leaves out

A test's [`dependencyHash`](/reference/output#tests) follows the names its code uses to where they are declared, in
its own file and through imports, and takes the code each module runs when it loads, declarations that call
something included. Some of what a test runs is out of its reach:

- Installed packages, such as `@playwright/test` or a library from `node_modules`. An upgrade shows in the lockfile,
  not in the hash.
- Files the code reads while it runs, with `fs` or `fetch`, environment variables, and the clock.
- Modules loaded by a path worked out at run time, as in ``import(`./venues/${venue}`)``, or by a pattern, as with
  `import.meta.glob()`, and a value imported from a module that only a declaration file (`.d.ts`) describes. The test
  gets `hasUnfollowedDependencies`, with a `dependency-not-followed` warning.
- Vitest's automatic mocks in `__mocks__` folders. A module `vi.mock()` names is in the hash, though its mock may
  replace it.
- Config files, setup files and global setup.
- Types, which don't run. For a type test (`*.test-d.ts`), the hash follows the types it uses instead.
- What a single-file component (`.vue`, `.svelte`) imports. A file that isn't JavaScript or TypeScript, such as a
  component or JSON, is taken by its text.

Some of what the hash takes is more than the test needs, so a change can change the hash of a test it doesn't affect:

- A test's fixtures are those that the test, the hooks around it, conditions such as `test.skip(({ account }) => ...)`
  and `test.use()` values ask for, in the code the test reaches, helper functions that take the test object included,
  with the fixtures those ask for. Any of them that takes its fixtures whole, as in `async (fixtures) => ...`, or whose
  function the scan can't find, such as a hook a factory returns or one held in a `let`, or a fixture from an installed
  package, brings in every fixture of the test's objects.
- A fixtures file that overrides Playwright's own fixtures or options, such as `page`, `context`, `storageState` or
  `baseURL`, or a fixture with `auto: true`, is in the hash of every test that uses the test object.
- A test object whose fixtures aren't written as an object literal in `extend()`, as in `base.extend(fixtures)`, is
  taken with all of them.
- A helper function that declares tests is taken whole for each test it declares.
- Importing a module runs the code of every module it imports, as a barrel file does for each module it re-exports,
  so all of that is in the hash, whichever export the test uses.

When one file's code is scanned with `scanSource()`, no import is read, so a test that uses a local module has
`hasUnfollowedDependencies` without a warning.

## What a scan never sees

Tests created inside a function from an installed package, or from a file the scan can't read, as in
`registerOrderTests(orderTicket)`, are not listed, and nothing in the output says so: the call does not look like a
test. When a call does look like a test and goes
through an import that can't be followed, an `unresolved-test-import` error says tests are missing.
