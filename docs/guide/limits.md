---
description: What a scan can't know without running the code, such as config files and imported values.
---

# Known limits

test-inventory reads the code as text and builds a syntax tree. It does not run the code, so a few things the
runner knows at run time are out of its reach. Most limits below show up in the output, as a diagnostic or a key
such as `isInLoop`; each section says when one does not.

## Config files are not read

`playwright.config.*` and `vitest.config.*` can change which tests run and how: `grep`, `testIgnore`, `forbidOnly`,
`fullyParallel`, projects, and Vitest tags with options. The scan reads only the test files. A test that a config
`grep` leaves out is still listed, and `isParallel` only reflects what is written in the file. Nothing in the output
says so.

When a Vitest file uses tags, a `config-may-change-state` warning points out that a tag defined in the config can
skip a test or change how it runs.

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
  install, from the `workspaces` of `package.json` or from `pnpm-workspace.yaml`. Patterns and links that lead out of
  the workspace folder are not followed.

A custom `test` object is followed through as many files as it takes: a fixtures file may re-export it, as in
`export * from './base'`, or build it with `extend` on a test object it imports from another file.

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
by a condition such as `isCI ? it.skip : it`: this test is listed as `active`, not as a conditional skip. Only what the
function returns itself is followed, not the result of another function it calls.

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

## What a scan never sees

Tests created inside a function from an installed package, or from a file the scan can't read, as in
`registerOrderTests(orderTicket)`, are not listed, and nothing in the output says so: the call does not look like a
test. When a call does look like a test and goes
through an import that can't be followed, an `unresolved-test-import` error says tests are missing.
