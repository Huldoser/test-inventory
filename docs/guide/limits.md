---
description: What a scan can't know without running the code, such as config files and values from installed packages.
---

# Known limits

These are **shared scanner limits**. For runner-specific settings and exceptions, read the configuration and limits
section of your guide:

[Playwright](/frameworks/playwright#configuration-and-limits) · [Vitest](/frameworks/vitest#configuration-and-limits) · [Jest](/frameworks/jest#configuration-and-limits) · [Mocha](/frameworks/mocha#configuration-and-limits) · [Jasmine](/frameworks/jasmine#configuration-and-limits) · [Cypress](/frameworks/cypress#configuration-and-limits) · [WebdriverIO](/frameworks/webdriverio#configuration-and-limits) · [node:test](/frameworks/node#configuration-and-limits) · [Bun](/frameworks/bun#configuration-and-limits)

test-inventory reads the code as text and builds a syntax tree. It does not run the code, so a few things the
runner knows at run time are out of its reach. Most limits below show up in the output, as a diagnostic or a key
such as `isInLoop`; each section says when one does not.

## Reading configs and settings {#config-files-are-read-only-in-part}

### File and project selection

The scan reads supported file selection and run settings from config source without executing it.
The [framework guides](/frameworks/) explain each runner's config lookup, defaults and exceptions;
the [configs reference](/reference/output#configs) describes the exact output.

A setting computed at run time, for example from `process.env`, or imported from an installed package cannot be
worked out. When needed by the scan, a `config-value-unknown` warning names it. A run setting chosen by a condition,
such as `retries: process.env.CI ? 2 : 0`, is `null` with source `config`; `retriesConfigText` and the other
`ConfigText` keys keep its source. A config selected only by runner command-line arguments is not inferred.

Setup files are tracked for dependencies and hashes, not executed to discover arbitrary runtime effects.
`expectCount`, `steps` and `fixtures` inspect the test function only: assertions and steps inside page objects or
helpers, and fixtures established by other or automatic fixtures, are not in them. A test, describe or hook callback
passed by name is read when declared in the file, not when imported. See your framework guide for runtime setting
calls that are not read.

Named describe callbacks are read in their lexical scope, inside each suite that calls them, including expanded table cases. Reusing one callback does not add a second copy where the function is declared. They use the same depth and call-count bounds as directly called helpers; recursion or a depth limit produces a `test-in-function` warning instead of following more nested tests. Named callbacks keep the runner's rules for async describes and callback arguments.

## Resolving project code and values

### Values from installed packages are not worked out {#values-from-installed-packages-are-not-worked-out}

Titles, tags, annotations, reasons, run settings and tables are worked out when they are built from values the scan
can read: string and number literals, constants, enums, arrays and objects built from them, spreads, string
concatenation, template strings, arithmetic, `?:`, `&&`, `||`, `??`, comparisons, `Object.keys()`, `Object.values()`,
`Object.entries()`, `JSON.stringify()`, `String()`, and a string's `toUpperCase()`, `toLowerCase()` and `trim()` and an
array's `join()`. Such values may be written in the file or exported by another file of the project, JSON files
included. A function or class written in place as a title, as in `describe(function OrderBook() {}, ...)`, gives its
name, as the runners read it:

```ts
import { TAGS } from '../../test-data/tags';

test('cancels an open limit order', { tag: TAGS.risk }, async ({ orderTicket }) => {
  // listed with the @risk tag
});
```

A value from an installed package, or built with any other call, is not. Nor is a constant the module changes while
it loads, as in `WATCHED.push('MSFT')`, or a function parameter or loop variable the code assigns to, since the
declared value may not be the one the runner reads. The record then keeps what it can and a
diagnostic says so, naming the module when the value comes from an import:

```ts
import { TAGS } from '@trading/qa-tags';

test('cancels an open limit order', { tag: TAGS.risk }, async ({ orderTicket }) => {
  // listed without the tag, with an unresolved-tag warning
});
```

Values, a custom `test` object, and a function that declares tests, as described under
[tests in helper functions](#tests-in-helper-functions), are followed through imports found through:

- a supported alias from the importing file's runner config, tried first; see your [framework guide](/frameworks/);
- a relative path, as in `../fixtures`; a `.js` or `.jsx` extension also finds the `.ts` or `.tsx` file, as
  TypeScript does;
- a path alias from `compilerOptions.paths` or `baseUrl` in the tsconfig nearest the importing file, with every file
  it `extends`, packages such as `@trading/tsconfig` included. Without a `tsconfig.json`, the nearest
  `tsconfig.base.json` is used, as in an Nx workspace; a solution-style tsconfig takes them from the projects it
  `references`. When no file of a matching pattern exists, the import goes on to the usual lookup, as in
  TypeScript;
- an `imports` entry in the nearest `package.json`, as in `#fixtures`;
- a workspace package whose `exports`, `types` or `main` point to TypeScript source, or to build output with the
  source next to it, as `dist/esm/index.js` is to `src/index.ts`: through its link in `node_modules`, or before an
  install, from the `workspaces` of `package.json` and from `pnpm-workspace.yaml`. Patterns and links that lead out of
  the workspace folder are not followed.

CommonJS is followed the same way: `const { SYMBOLS } = require('../data/symbols')` and
`const symbols = require('../data/symbols')` of a local file read what it exports with `module.exports = { ... }`,
`module.exports = function registerSettlement(desk) {...}` or `exports.SYMBOLS = [...]`.

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

An alias explicitly configured with an unreadable replacement marks its imports as unfollowed, including bare package-like names. An unreadable alias entry or `find` in an array can match any import, so imports that reach it are marked unfollowed too. Supported setup files use config aliases too; your [framework guide](/frameworks/) lists their treatment.

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
by a condition such as `isCI ? it.skip : it`, or with `&&`, `||` or `??`, as in `isCI && it.skip || it`: this test
is listed as `active`, not as a conditional skip. A function
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

Playwright helper-state handling is covered in the [Playwright guide](/frameworks/playwright#states-set-in-helper-functions).

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

A function imported from another file is followed the same way, through the imports above, also when a shared file
imports it and exports it again, as an `index.js` of helpers does. Its records give the call
in the scanned file as their location, since that is the line that registers the tests, and `declaredAt` gives the
file and line where the helper writes the test.

Helpers are followed up to 16 calls deep, and at up to 10,000 calls in a file, counting the calls inside helpers; real
suites make far fewer. Past 10,000, a `test-in-function` warning marks the call where the scan stopped.

A `test-in-function` warning remains for tests in a function the scan can't place: one that nothing in the file calls
by name, one the file only exports, and one called only from tests or hooks, where the runner doesn't collect tests.
Such a test is listed where it is written. Tests in a callback passed to another function, as in
`withPaperAccount(() => { test(...) })`, are listed where they are written, with no warning.

## Loops and tables are one record

A test declared in a loop, `forEach` or `map` is listed once, with `isInLoop: true`. When the loop goes over values
the scan can count, as in `for (const symbol of WATCHED_SYMBOLS)` or `Object.keys(FEES).forEach(...)`, and
registers the test on every pass, `caseCount` says how many tests the runner registers. Otherwise `caseCount` is `null`
and a `test-in-loop` warning says the count is unknown: for a `while` loop, a loop with `break`, `continue`, `return`
or `throw` in it, and a test under a condition inside the loop, such as one in a helper after
`if (!strategy.enabled) return;`.
A `test.each` or `test.for` table is listed once, with `isParameterized: true` and `caseCount` set when the scan can
count its rows. A list written out, its spreads, a constant the file doesn't change, and `Object.keys()`,
`Object.values()` and `Object.entries()` of an object written out can be counted even when one of their values can't
be worked out, as in `[NaN, Infinity].forEach(...)` or a table with a call in a row.

With `--expand-cases` (library: `expandCases: true`), each case of a table and each pass of a loop whose values the
scan can work out is its own record, with the title the runner gives it, its `caseIndex`, and a `caseCount` of 1. The
values of the case are bound in its callback, as the runner passes them, so a title, tag or condition built from
them is worked out per case, and an `if`, `?:`, `&&`, `||` or `??` that decides whether a test is registered takes
the branch they give when it reads nothing but them. A condition on a constant of the module still has both branches,
under the condition, since code the scan doesn't follow may change the constant. Loops in test and hook bodies, which
the runner runs after collecting the tests, and loops over a `var`, are not expanded. The [Vitest guide](/frameworks/vitest#tables-and-case-titles) explains why. A loop or describe table
outside any other is expanded while the file has fewer than 1,000 expanded loop passes and describe cases, and then
in whole; past that, loops and describe tables that register tests are one record with a `cases-not-expanded`
warning, so that a long loop over test data can't slow the scan down.

Framework-specific title rules are in the [Vitest guide](/frameworks/vitest#tables-and-case-titles).

## Conditions are not evaluated

`test.skip(browserName === 'webkit', 'reason')` gives `state: 'skip'` with `isConditional: true` and the condition's
source text. Whether the test is skipped on a given run depends on the browser, the environment or the clock. A
condition the scan can work out, such as `test.skip(true)`, `test.skipIf(MARKET === 'crypto')` with `MARKET` a
constant, or `test.skip(side === 'short')` in a helper called with `'buy'`, is worked out.

A skip inside `if`, `?:`, `&&`, `||`, `??`, `switch` or a `catch` block runs only when that code does, so it is
conditional too, with the source text of what decides it as its condition. For a `catch` block that is the clause
itself, `catch` or `catch (error)`, since the block runs only when the `try` block throws.

Code after an `if` whose branch always returns, throws, breaks or continues, as in `if (!account.active) return;`,
runs only when that branch isn't taken, so it is under the opposite condition, `!(!account.active)` here. A branch that
leaves on only some of its paths, as in `if (isEquity) { if (isHoliday) return; }`, leaves what follows as it is.

## Dependency coverage {#what-dependencyhash-leaves-out}

### Dependencies the hash cannot follow

A test's [`dependencyHash`](/reference/output#tests) follows the names its code uses to where they are declared, in
its own file and through imports, and takes the code each module runs when it loads, declarations that call
something included. Some of what a test runs is out of its reach:

- Installed packages in `node_modules`. An upgrade shows in the lockfile, not in the hash.
- Aliases missing from tsconfig or supported runner config settings. An unresolved import starting with `@/` or `~/`
  gives `hasUnfollowedDependencies` and a `dependency-not-followed` warning. Other aliases, such as `@app/pricing`,
  read as installed packages.
- Files read at runtime through `fs` or `fetch`, environment variables and the clock.
- Runtime import paths, patterns such as `import.meta.glob()`, and modules described only by `.d.ts` files.
  These give `hasUnfollowedDependencies` and a `dependency-not-followed` warning.
- A config selected only by the runner's `--config`. A setup path computed at runtime, such as
  `setupFiles: process.env.SETUP` or `require.resolve('./global-setup')`, or a nonexistent path gives a
  `dependency-not-followed` warning.
- Types, which do not run. For `*.test-d.ts` type tests, the hash follows their types instead.
- A Vue component's script loaded with `src`, such as `<script src="./watchlist.ts">`.

Runner-specific gaps and broader dependencies are described under
[Playwright fixtures and snapshots](/frameworks/playwright#fixtures-snapshots-and-dependency-hashes) and
[Vitest mocks and snapshots](/frameworks/vitest#mocks-snapshots-and-dependency-hashes).
Snapshot directories reached through symlinks are not followed; linked files are.

Some dependencies are broader than one test's use, so unrelated changes can also change its hash:

- A helper that declares tests is taken whole for each declared test.
- Every module imported or re-exported by an imported module contributes its load-time code, even if the test uses
  only one export.
- Vue and Svelte single-file components are taken whole, with imports from JavaScript or TypeScript `<script>`
  blocks. Types are included because markup can use them and Vue builds `defineProps<Props>()` from them.
  Non-JavaScript script blocks, such as `application/ld+json`, are excluded from import traversal.
- Other text files, such as JSON, are taken as text, and binary files, such as images, as bytes.

When one file's code is scanned with `scanSource()`, no import is read, so a test that uses a local module has
`hasUnfollowedDependencies` without a warning.

## Variables assigned again

A variable that holds a test function keeps the value it is declared with: after `let it = test; it = test.skip;`,
`it('settles a trade', fn)` is read as an active test, while the runner skips it.

## What a scan never sees

Tests created inside a function from an installed package, or from a file the scan can't read, as in
`registerOrderTests(orderTicket)`, are not listed, and nothing in the output says so: the call does not look like a
test. The same goes for a function a setup file puts on `globalThis`, as Jest projects often do, and for packages
that write the tests for you, such as `babel-plugin-tester`. When a call does look like a test and goes
through an import that can't be followed, an `unresolved-test-import` error says tests are missing.

Files with Flow type annotations, which React and React Native projects compile with Babel before Jest runs them,
can't be parsed: they get a `parse-error`, and their tests are missing.
