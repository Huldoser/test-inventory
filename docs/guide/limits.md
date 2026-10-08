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

The one import that is followed is a custom `test` object, one file deep. It is found through:

- a relative path, as in `../fixtures`;
- a path alias from `compilerOptions.paths` or `baseUrl` in the root `tsconfig.json`, and the file it `extends`, one
  level;
- an `imports` entry in the nearest `package.json`, as in `#fixtures`;
- a workspace package linked into `node_modules`, when its `exports`, `types` or `main` point to TypeScript source.

Installed packages are not followed. When a call shaped like a test, outside any test or hook body, uses a name from
an import that can't be followed, an `unresolved-test-import` error names the import and says why: the file is missing
or can't be parsed, the package is installed, or the file builds or re-exports its test object from another module.
The tests that use it are missing. The error needs a name that reads like a test function, as in
`brokerTest('routes to NASDAQ', ...)`, or a member such as `.describe` after it. Helpers shaped the same way, such as
`waitForFill('AAPL', (order) => ...)`, are not reported. `scanSource()` reads no files, so it follows no imports.

## Test objects made by helpers

A test object returned by a function the scan cannot follow is read on trust, with one `local-test-object` warning per
variable:

```ts
const test = createBrokerTest({ venue: 'NASDAQ' });

test('fills a market order', async ({ page }) => {});
```

This applies only to a variable named like a test object (`test`, `it`, `describe`, `suite` or a name ending in
`Test`) that is called with a title and a function, or through a member such as `test.skip`. Other calls, such as a
helper named `expectFill('AAPL', 100, 'filled', check)`, are not tests.

## States set in helper functions

In Playwright, a `test.skip()`, `test.fixme()`, `test.fail()` or `test.describe.configure()` call inside a plain
function of the same file applies to the tests, hooks and describes that call that function by name, also through
helpers that call other helpers:

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

## Loops and tables are one record

A test declared in a loop, `forEach` or `map` is listed once, with `isInLoop: true` and a `test-in-loop` warning.
A `test.each` or `test.for` table is listed once, with `isParameterized: true` and `caseCount` set when the table is
written in the file. The runner creates one test per iteration or per case; expanding them is planned for a later
release.

## Conditions are not evaluated

`test.skip(browserName === 'webkit', 'reason')` gives `state: 'skip'` with `isConditional: true` and the condition's
source text. Whether the test is skipped on a given run depends on the browser, the environment or the clock. A
condition written as a constant, such as `test.skip(true)` or `test.skipIf(false)`, is worked out.

## What a scan never sees

Tests created inside a function imported from another file, as in `registerOrderTests(orderTicket)`, are not listed,
and nothing in the output says so: the call does not look like a test. When a call does look like a test and goes
through an import that can't be followed, an `unresolved-test-import` error says tests are missing.
