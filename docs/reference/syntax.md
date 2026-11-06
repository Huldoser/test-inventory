---
description: The Playwright, Vitest, Jest, Mocha, Jasmine and Cypress imports, calls and modifiers a scan reads.
---

# Supported syntax

## Playwright

Playwright 1.42 and newer.

### Where test comes from

| Form                       | Example                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Named import, also renamed | `import { test } from '@playwright/test'`, `import { test as base } from '@playwright/test'`                                                                                                                                   |
| Default import             | `import pwTest from '@playwright/test'`                                                                                                                                                                                        |
| Namespace import           | `import * as pw from '@playwright/test'` then `pw.test(...)`                                                                                                                                                                   |
| CommonJS                   | `const { test } = require('@playwright/test')`, `require('@playwright/test').test(...)`                                                                                                                                        |
| Other packages             | `playwright/test`, `@playwright/experimental-ct-react` and the other component testing packages, and `playwright-bdd`, whose generated files import `test` from it                                                             |
| Derived                    | `base.extend({...})`, chained `.extend().extend()`, `mergeTests(a, b)`                                                                                                                                                         |
| Local fixtures file        | `import { test } from '../fixtures'`, or a path alias, `#` import or workspace package, followed through re-exports, `extend` chains and functions that build it, across files                                                 |
| Returned by a function     | `brokerTest('live')('sends an order', ...)`, also kept in a variable, where `brokerTest` is declared in the file or a local file and returns a test object or describe function                                                |
| Destructured members       | `const { describe, beforeEach } = test`, also nested, as in `const { describe: { serial } } = test`: each works as `test.describe` or `test.beforeEach` does. A test object built with a destructured `extend` is not followed |

### Calls

| Call                                                                                                                                          | Read as                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test(title, body)`, `test(title, details, body)`                                                                                             | A test. The body may be a function passed by name.                                                                                            |
| `test.only`, `test.skip`, `test.fixme`, `test.fail` with a title and body                                                                     | A test with that state.                                                                                                                       |
| `test.fail.only`                                                                                                                              | Expected to fail, with `isOnly`. Playwright 1.49 and newer.                                                                                   |
| `test.skip()`, `test.skip(condition, description)`, `test.skip(({ browserName }) => condition, description)`; the same for `fixme` and `fail` | At file or describe level, a state for every test in the scope. In a test body or hook, a state for that test or the tests the hook runs for. |
| `test.describe(title, callback)`, with details, or anonymous `test.describe(callback)`                                                        | A describe.                                                                                                                                   |
| `test.describe.only`, `.skip`, `.fixme`, `.serial`, `.serial.only`, `.parallel`, `.parallel.only`                                             | A describe with that state or mode.                                                                                                           |
| `test.describe.configure({ mode, lock })`                                                                                                     | The mode of the describe or file. `lock`, from Playwright 1.64, adds locks to every test in it.                                               |
| `test.info().annotations.push({ type, description })`                                                                                         | An annotation of the test.                                                                                                                    |
| `test.use`, `test.slow`, `test.setTimeout`, `test.step`, `test.step.skip` (1.50), `test.expect`, `test.info`, `test.abort` (1.60), hooks      | Known; not tests.                                                                                                                             |
| Any other chain, such as `test.only.skip`                                                                                                     | An `invalid-chain` error: Playwright fails to load the file and runs no tests at all.                                                         |

### Details

`{ tag, annotation, lock }`: `tag` is a string or an array of strings starting with `@`; `annotation` an object or
an array of `{ type, description }`; `lock` a string or an array of strings, from Playwright 1.63. Tags are also read
from `@words` in titles.

## Vitest

Vitest 3.0 and newer.

### Where test comes from

| Form                       | Example                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Named import, also renamed | `import { test, it, describe, suite } from 'vitest'`                                                                                                                                                                                                                                                                                                                                                                   |
| Namespace import           | `import * as vt from 'vitest'` then `vt.test(...)`                                                                                                                                                                                                                                                                                                                                                                     |
| Globals                    | `describe`, `it`, `test` and `suite` used without an import or declaration. A warning says when no config turns globals on.                                                                                                                                                                                                                                                                                            |
| In-source tests            | `const { it, describe } = import.meta.vitest`                                                                                                                                                                                                                                                                                                                                                                          |
| Describe callback          | `describe('fees', (test) => { test(...) })`: Vitest passes its `test` to the callback                                                                                                                                                                                                                                                                                                                                  |
| Derived                    | `test.extend({...})`, `test.extend('name', value)`, chained; `test.override()` and `test.scoped()` are known                                                                                                                                                                                                                                                                                                           |
| Local fixtures file        | `import { test } from './context'`, or a path alias, `#` import or workspace package, followed through re-exports, `extend` chains and functions that build it, across files                                                                                                                                                                                                                                           |
| Returned by a function     | `onNode(22)('reads the order book', ...)`, also kept in a variable, where `onNode` is declared in the file or a local file and returns a test or describe function, as in `it.skip`                                                                                                                                                                                                                                    |
| Destructured members       | `const { describe, skip, beforeEach } = test`: each works as `test.describe` or `test.skip` does. Some members read the function they are called on, so a call through one destructured fails the file, reported as `invalid-chain`: `each`, `for`, `skipIf` and `runIf` of `test` and `each` of `describe` in every version, `extend`, `scoped` and `override` from Vitest 4.1, and `for` of `describe` from Vitest 5 |

### Calls

| Call                                                                                                       | Read as                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test(title, fn)`, `test(title, options, fn)`, `test(title, fn, timeout)`                                  | A test. Without a function, a todo.                                                                                                                                                                      |
| `test(title, fn, options)`                                                                                 | Accepted before Vitest 4; a `removed-api` error from Vitest 4.                                                                                                                                           |
| `.concurrent`, `.only`, `.skip`, `.todo`, `.fails`, in any order and combination                           | `.only` wins over `.skip`, which wins over `.todo`.                                                                                                                                                      |
| `.each(table)`, `.for(table)`, also as tagged templates                                                    | One parameterized record, with `caseCount` when the scan can work out the table; one record per case with `--expand-cases`. A table that isn't an array is an `invalid-chain` error: Bun fails the file. |
| `.skipIf(condition)`, `.runIf(condition)`                                                                  | A conditional skip. `runIf(x)` is stored as the condition `!(x)`.                                                                                                                                        |
| `describe` with `.concurrent`, `.shuffle`, `.skip`, `.only`, `.todo`, `.each`, `.for`, `.skipIf`, `.runIf` | A describe. `describe(title)` without a function is a todo.                                                                                                                                              |
| `describe(fn)` without a title                                                                             | A `describe-not-called` error: Vitest never calls the function.                                                                                                                                          |
| `context.skip()`, `skip(note)`, `skip(condition, note)` in a test, `beforeEach` or `aroundEach`            | A state for that test, or for the tests in the describe.                                                                                                                                                 |
| Options `skip`, `only`, `todo`, `fails`, `concurrent`, `sequential`, `shuffle`, `tags` (4.1), `meta`       | Read when written in the file; a test's own states win over its chain.                                                                                                                                   |
| `// @module-tag name`                                                                                      | A tag on every test in the file, from Vitest 4.1.                                                                                                                                                        |
| `.sequential`                                                                                              | The default mode before Vitest 5; a `removed-api` error from Vitest 5.                                                                                                                                   |
| `bench(...)`, with `bench` imported from `vitest`                                                          | A `removed-api` error from Vitest 5. Benchmarks are never tests.                                                                                                                                         |
| `vi.mock`, `vi.unmock`, `vi.hoisted` below the top level of the file                                       | A `removed-api` error from Vitest 5, except in files with in-source tests.                                                                                                                               |
| Any other chain, such as `test.fixme`                                                                      | An `invalid-chain` error.                                                                                                                                                                                |

## Jest

Jest 29.0 and newer.

### Where test comes from

| Form                       | Example                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Globals                    | `describe`, `it`, `test`, `fit`, `xit`, `xtest`, `fdescribe` and `xdescribe` used without an import or declaration                                                                      |
| Named import, also renamed | `import { test, it, describe, xit } from '@jest/globals'`                                                                                                                               |
| The module                 | `import * as globals from '@jest/globals'`, a default import (with Babel or TypeScript), or `require('@jest/globals')`, whole, destructured or in place                                 |
| Kept in a variable         | `const onCi = process.env.CI ? test.skip : test`: only what both branches share applies                                                                                                 |
| Local helpers file         | `import { it } from './helpers'` or `require('./helpers')`, followed as for Vitest, a global it exports, as `export const pendingTest = xit`, and functions that return a test function |

`fit` and `fdescribe` are `.only`; `xit`, `xtest` and `xdescribe` are `.skip`. As in Jest, a describe's own `.only` or
`.skip` wins over the one around it, a skipped describe skips every test in it, a todo or a `.only` too, and in a
`describe.only` that has a test with its own `.only`, its other tests are left out of focus. A file that uses the
globals while its config sets `injectGlobals: false` gets a `globals-not-enabled` warning.

### Calls

| Call                                                                               | Read as                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test(title, fn)`, `test(title, fn, timeout)`                                      | A test, with `timeout` when the third argument is a number the scan can work out.                                                                                                                  |
| `test.todo(title)`                                                                 | A todo. With more than a title, an `invalid-chain` error: Jest fails the file.                                                                                                                     |
| `test(title)`, `describe(title)` without a function                                | A `test-without-body` error: Jest fails the file.                                                                                                                                                  |
| `.only`, `.skip`, `.concurrent`, `.failing`, `.each`, on the paths Jest has        | `test.concurrent.only.each` exists, `test.only.concurrent` doesn't and is an `invalid-chain` error. `.failing` is `expectedToFail`.                                                                |
| `.each(table)`, also as a tagged template                                          | One parameterized record, with `caseCount`; one record per case with `--expand-cases`, titled as jest-each titles it. A table that isn't an array is an `invalid-chain` error: Bun fails the file. |
| `describe`, `describe.only`, `describe.skip`, `describe.each`                      | A describe. An async callback is an `async-describe` error: Jest fails the file.                                                                                                                   |
| `test.each(table)(title)` without a function                                       | One test that always fails, as Jest registers, with a `test-without-body` warning; the file still loads.                                                                                           |
| `test(title, 42, fn)`, `describe(title, {}, fn)`                                   | A `test-without-body` error: Jest takes the function second, and fails the file.                                                                                                                   |
| A describe callback that returns a value, or a `describe.each` with an empty table | A `describe-throws` error: Jest fails the file. A callback that returns a promise is an `async-describe` error.                                                                                    |
| `jest.retryTimes(n)`                                                               | `retries` on every test of the file: the last call made while the file loads wins, also from inside a describe.                                                                                    |
| `jest.retryTimes(n, { entireDescribe: true })`                                     | From Jest 30.5, `retries` on the tests of the describe it is called in.                                                                                                                            |
| `jest.retryTimes(n, { waitBeforeRetry })`                                          | From Jest 30.0, the wait between retries as `retryDelay`.                                                                                                                                          |
| `@group name` in a comment                                                         | A tag on every test in the file, as jest-runner-groups reads it: any line of the file that starts with `@group`, after a comment's `*`.                                                            |

Jest's `.each` titles take `%p`, `%s`, `%d`, `%i`, `%f`, `%j`, `%o`, `%O`, `%#`, from Jest 30 `%$`, and `$name.path` and
`$#` for tables of objects and tagged templates. A title that shows an object through `%s` or `%o` stays one record with
`--expand-cases`, as Node.js prints objects differently from one version to the next.

## Mocha

Mocha 10.0 and newer.

### Where test comes from

| Form                       | Example                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Globals                    | `describe`, `context`, `it`, `specify`, `xdescribe`, `xcontext`, `xit` and `xspecify` used without an import or declaration; with `ui: tdd` in the config, `suite` and `test` |
| Named import, also renamed | `import { describe, it } from 'mocha'`                                                                                                                                        |
| The module                 | `import * as mocha from 'mocha'`, a default import, or `require('mocha')`, whole, destructured or in place                                                                    |
| Kept in a variable         | `const onCi = process.env.CI ? it.skip : it`: only what both branches share applies                                                                                           |
| Local helpers file         | `import { it } from './helpers'` or `require('./helpers')`, followed as for Vitest, and helper functions that declare tests, read at each call                                |

`xit`, `xspecify`, `xdescribe` and `xcontext` are `.skip`. Mocha's QUnit and exports interfaces, and a `ui` that names
a package, are reported on the config with a `config-value-unknown` warning, and the files are read as BDD.

### Calls

| Call                                                                                            | Read as                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `it(title, fn)`, `specify(title, fn)`                                                           | A test.                                                                                                                                                                                                                                                           |
| `it(title)` without a function                                                                  | A skipped test: Mocha reports it as pending.                                                                                                                                                                                                                      |
| `.only`, `.skip`                                                                                | `isOnly`, or a skipped test or describe. Any other member, as `it.concurrent`, is an `invalid-chain` error: Mocha stops before it runs any test, in this file or any other.                                                                                       |
| `describe(title, fn)`, `context(title, fn)`                                                     | A describe. An async callback is allowed, as Mocha allows it.                                                                                                                                                                                                     |
| `describe(title)` without a function                                                            | A `test-without-body` error: Mocha stops before it runs any test. `describe.skip(title)` is allowed.                                                                                                                                                              |
| `before`, `after`, `beforeEach`, `afterEach`, with or without a title                           | Hooks, counted as `beforeAll`, `afterAll`, `beforeEach` and `afterEach`; with `ui: tdd`, `suiteSetup`, `suiteTeardown`, `setup` and `teardown`.                                                                                                                   |
| `this.timeout(ms)`, `this.retries(n)` in a describe written as a `function`                     | `timeout` and `retries` on its tests and those of the describes inside it. A timeout may be a number or a string such as `'2s'`; `0`, and one of 2,147,483,647 ms or more, turns it off.                                                                          |
| `this.timeout(ms)`, `this.retries(n)` in a test written as a `function`                         | The test's own `timeout` and `retries`. In a hook, `this.timeout()` sets the hook's own timeout, which no record holds.                                                                                                                                           |
| `it(...).timeout(ms)`, `it(...).retries(n)`, `describe(...).timeout(ms)`                        | The same settings on the test the call returns. On a describe, only the timeout, and only from Mocha 12, which reads it as each test runs; before, a describe's tests take its timeout when they are added. `describe(...).retries(n)` reaches none of its tests. |
| `this.skip()` in a test or a `before`, `beforeEach` or `afterEach` hook written as a `function` | The test, or the tests the hook runs for, skipped; under a condition, `isConditional`.                                                                                                                                                                            |

`this` is Mocha's context only directly in the test's, hook's or describe's own function: in an arrow function, or a
function inside it, `this.timeout()` and `this.skip()` are not read. A test takes its describe's `retries`, and before
Mocha 12 its `timeout`, when it is added, so a test written above `this.retries()` in the same describe doesn't get
them; the scan applies them to every test of the describe. A `beforeEach` or other hook written at the top level of one
spec file runs around the tests of every file, but is counted only in that file. A loop that declares tests, such as
`['XNAS', 'XLON'].forEach((mic) => it(...))`, is one record with `caseCount`, as for the other runners. Root hooks,
which a file the config lists in `require` exports as `mochaHooks`, run around every test, but are not counted in
`hooks`; the file is in each test's `dependencies`.

## Jasmine

Jasmine 4.0 and newer.

### Where test comes from

| Form               | Example                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Globals            | `describe`, `xdescribe`, `fdescribe`, `it`, `xit` and `fit`, which the jasmine command, Karma or a browser page set; Jasmine has no module to import them from |
| Kept in a variable | `const later = xit`: the variable keeps the `x` or `f`                                                                                                         |
| Local helpers file | `import { spec } from './helpers'` or `require('./helpers')`, followed as for Vitest, and helper functions that declare specs, read at each call               |

`xit` and `xdescribe` are `.skip`, and `fit` and `fdescribe` `.only`. Jasmine's functions have no members, so a call
such as `it.only()` is an `invalid-chain` error. Jasmine runs the innermost focus: a `fit` runs also inside an
`xdescribe`, and in an `fdescribe` with a `fit` or `fdescribe` below it, only those run, so its other specs have
`isOnly: false`.

### Calls

| Call                                                              | Read as                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `it(title, fn)`, `it(title, fn, timeout)`                         | A spec, with `timeout` when the third argument is a number the scan can work out.                                                                                                                                                                                    |
| `it(title)`, `xit(title)` without a function, or with `undefined` | A skipped spec: Jasmine reports it as pending; `it()` is one titled `''`. `fit(title)` without one is a `test-without-body` error.                                                                                                                                   |
| `it(title, 42)`                                                   | A `test-without-body` error: Jasmine takes the function second.                                                                                                                                                                                                      |
| `describe(title, fn)`                                             | A describe. Without a function, a `test-without-body` error, also for `xdescribe`; with an async callback, an `async-describe` error; with a callback that takes arguments, or that declares no spec or describe, as one with only hooks, a `describe-throws` error. |
| `beforeAll`, `beforeEach`, `afterEach`, `afterAll`                | Hooks, also with a timeout as their second argument.                                                                                                                                                                                                                 |
| `pending(reason)` in a spec, `beforeEach` or `afterEach`          | The spec skipped with the reason; under a condition, `isConditional`. In `beforeAll` or `afterAll`, Jasmine reports it as an error of the describe, and the specs keep their state.                                                                                  |
| `notApplicable(reason)` in a spec                                 | From Jasmine 7, the spec skipped with the reason. Before, the call fails the spec.                                                                                                                                                                                   |

Where an error is written decides what Jasmine does. At the top level of a file, it stops Jasmine before it runs any
spec, in this file or any other, and every test in the file is `notLoaded`. Inside a describe, Jasmine catches it: it
reports the describe as failed and registers none of the specs written after the call in it; the scan reports the
error, keeps the file's tests as they are, and still lists those later specs. `jasmine.DEFAULT_TIMEOUT_INTERVAL` set in
a helper or spec file is not read. A `beforeEach` in a helper file runs around every spec, but is not counted in
`hooks`.

## Cypress

Cypress 13.0 and newer.

### Where test comes from

| Form               | Example                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Globals            | Mocha's BDD globals, `describe`, `context`, `it`, `specify`, their `x` forms and the hooks, which Cypress sets in every spec                   |
| Kept in a variable | `const later = it.skip`: only what both branches of a choice share applies                                                                     |
| Local helpers file | `import { it } from './helpers'` or `require('./helpers')`, followed as for Vitest, and helper functions that declare tests, read at each call |

### Calls

Cypress reads tests and describes as Mocha does, with these differences:

| Call                                                                      | Read as                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `it(title, config, fn)`, `describe(title, config, fn)`                    | A test or describe with Cypress's test config, before its function. `it(title, config)` without a function is a test that runs and fails, as Cypress then gives Mocha the config as its function. |
| `retries` in a test config                                                | `retries`; for `{ runMode, openMode }`, `runMode`, which `cypress run` uses. A describe's passes to its tests. `null` sets none.                                                                  |
| `browser` in a test config                                                | The test, or a describe's tests, skipped under a condition, `browser: '!firefox'` as written: Cypress runs them only in the browsers it names.                                                    |
| `tags` in a test config                                                   | `tags`, a string or a list, as `@cypress/grep` reads them. A describe's pass to its tests.                                                                                                        |
| `env` in a test config                                                    | From Cypress 16, a `removed-api` error: Cypress 16 fails each test it applies to when the test runs.                                                                                              |
| `this.retries()` in a describe, `.retries()` after `it()` or `describe()` | A `describe-throws` or `invalid-chain` error: Cypress throws while it loads the spec. In a test or hook, `this.retries()` fails only that test or hook, when it runs, and is not reported.        |
| `this.timeout()`, `it(...).timeout()`                                     | Not read: Cypress has no test timeout, only command timeouts.                                                                                                                                     |

A call Cypress refuses, as `it.concurrent()` or a describe without a function, fails its spec, and every test in the
file is `notLoaded`; the other specs run.

## WebdriverIO

WebdriverIO 9.0 and newer, with Mocha or Jasmine. The config's `framework` decides which, Mocha by default; Cucumber's
feature files are not read.

### Where test comes from

| Form               | Example                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Globals            | With Mocha, its BDD globals, or with `mochaOpts.ui: 'tdd'` `suite` and `test`; with Jasmine, `describe`, `it` and their `x` and `f` forms. WebdriverIO sets them in every spec file. |
| Kept in a variable | `const later = it.skip`: only what both branches of a choice share applies                                                                                                           |
| Local helpers file | `import { it } from './helpers'` or `require('./helpers')`, followed as for Vitest, and helper functions that declare tests, read at each call                                       |

### Calls

Tests and describes are read as in [Mocha](#mocha) or [Jasmine](#jasmine), with these differences:

| Call                                | Read as                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `it(title, fn, n)` with Mocha       | `retries`: WebdriverIO runs the function up to `n` more times when it fails. It does so inside each of Mocha's attempts, so with `this.retries()` as well, the record shows WebdriverIO's count; `0` leaves Mocha's. `it.only` and `it.skip` drop the count, as they pass Mocha only the title and function.                                                                                                                        |
| `it(title, fn, ms, n)` with Jasmine | `timeout`, as in Jasmine, and `retries`, WebdriverIO's.                                                                                                                                                                                                                                                                                                                                                                             |
| A Mocha or Jasmine version gate     | Read with the version WebdriverIO depends on: Mocha 12 and Jasmine 6 from WebdriverIO 10, Mocha 10.8 and Jasmine 5 before. So `describe(...).timeout(ms)` reaches its tests from WebdriverIO 10, and Jasmine 7's `notApplicable()` is not read.                                                                                                                                                                                     |
| A call the runner refuses           | The same errors as in Mocha or Jasmine, with what WebdriverIO does then. With Mocha, the file stops loading at the call: the tests declared above it run, those below are `notLoaded`, and the spec files grouped after it in the same worker don't run. With Jasmine, a call refused at the top level fails the whole worker: the file's tests are `notLoaded`, and the files grouped with it don't run either. Other workers run. |

## node:test

Node.js 22.0 and newer, the version the project pins; see [framework version](/guide/cli#framework-version).

### Where test comes from

| Form                       | Example                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Default import             | `import test from 'node:test'`, whose `test` also carries `describe`, `it`, `suite` and the hooks                                              |
| Named import, also renamed | `import { describe, it, suite, test } from 'node:test'`                                                                                        |
| `require()`                | `const test = require('node:test')`, whole, destructured or in place, as `require('node:test').it(...)`                                        |
| Kept in a variable         | `const later = test.skip`: only what both branches of a choice share applies                                                                   |
| Local helpers file         | `import { it } from './helpers'` or `require('./helpers')`, followed as for Vitest, and helper functions that declare tests, read at each call |

node:test sets no globals: `it()` without an import is not a test.

### Calls

| Call                                                           | Read as                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test(name, options, fn)`, `it`, and `describe` or `suite`     | A test or describe. Each part may be left out: without a name, the test is named after its function, or `<anonymous>`; an object first is the options. A test without a function runs and passes.                                                               |
| `.skip`, `.todo`, `.only`, from Node.js 24.14 `.expectFailure` | A skipped or todo test or describe, `isOnly`, or `expectedToFail`. Any other member, as `test.concurrent`, is an `invalid-chain` error: Node.js fails the file and runs none of its tests.                                                                      |
| `{ skip }`, `{ todo }`                                         | A skipped or todo test or describe, with a string as its reason; only `false` and `undefined` set nothing, as in Node.js, where even `''` and `0` skip. A value the scan can't work out is a condition. `skip` wins over `todo`, and both over `expectFailure`. |
| `{ only }`                                                     | `isOnly`. Under `node --test`, Node.js applies it only with `--test-only`.                                                                                                                                                                                      |
| `{ timeout }`, `{ concurrency }`                               | `timeout`, and `isParallel` for the tests inside a describe or test whose `concurrency` is `true` or above 1.                                                                                                                                                   |
| `{ expectFailure }`                                            | From Node.js 24.14 and 25.5, `expectedToFail`; from 24.15 and 25.8 a string is its label, in `reason`.                                                                                                                                                          |
| `{ tags }`                                                     | From Node.js 24.19 and 26.2, `tags`.                                                                                                                                                                                                                            |
| `t.skip(reason)`, `t.todo(reason)`                             | On the test's context, its function's first parameter: the test skipped or todo. The body still runs, and so do its subtests.                                                                                                                                   |
| `t.test(...)`, or `test()` or `it()` called in a test's body   | A subtest: a test record with the titles of the tests around it in `suitePath` and the test that runs it in `parentTestId`. A subtest of a test skipped where it is declared is skipped too, as its body never runs.                                            |
| `before`, `after`, `beforeEach`, `afterEach`                   | Hooks, counted as `beforeAll`, `afterAll`, `beforeEach` and `afterEach`.                                                                                                                                                                                        |

Not read: `t.todo()` before a `t.test()` call, which makes the subtest todo too; `t.skip()` in a `beforeEach` hook,
which skips each test; `t.test()` in a helper function the test passes its context to; and a `describe` inside a test
body, which runs as a nested describe and gets a `nested-test` warning. A glob in a script is read as written, though
`sh`, which npm runs scripts with, reads an unquoted `**` as `*`; quote it, as Node.js expands it then.

## Bun

Bun 1.2.23 and newer, which runs tests the way 1.3 and 1.4 do; see [framework version](/guide/cli#framework-version).

### Where test comes from

| Form               | Example                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Globals            | `test`, `it`, `describe`, `xtest`, `xit`, `xdescribe` and the hooks, which `bun test` sets in its test files                                                                          |
| Imports            | `import { describe, test } from 'bun:test'`, a namespace or default import, or `require('bun:test')`; imports from `@jest/globals` and `vitest` too, which Bun rewrites to `bun:test` |
| Kept in a variable | `const later = test.skip`: only what both branches of a choice share applies                                                                                                          |
| Local helpers file | `import { it } from './helpers'` or `require('./helpers')`, followed as for Vitest, and helper functions that declare tests, read at each call                                        |

### Calls

| Call                                                                               | Read as                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test(title, fn, options)`, `test(title, options, fn)`                             | A test. Options are a number, the timeout, or `{ timeout, retry, repeats }`. Both `retry` and `repeats` are an `invalid-chain` error from Bun 1.3, which refuses them.                                                                                                                                                                                                                                                                                                                                                                 |
| `.skip`, `.todo`, `.failing`, `.only`, `.concurrent`, `.serial`                    | A skipped, todo or `expectedToFail` test, `isOnly`, or `isParallel`. A chain may hold them in any order, but only one of `skip`, `todo` and `failing`, one `only`, and one of `concurrent` and `serial`; another is an `invalid-chain` error: Bun fails the file. `skip` wins over `todo`, and `todo` over `failing`.                                                                                                                                                                                                                  |
| `.if(condition)`, `.skipIf`, `.todoIf`, `.failingIf`, `.concurrentIf`, `.serialIf` | A state under a condition: `if` skips when its condition is false, the others set theirs when it is true. A condition that holds counts as its mode in the chain, so `test.todoIf(true).failing` is an `invalid-chain` error as `test.todo.failing` is; one the scan can't work out counts as not holding. A describe can't be `failing`.                                                                                                                                                                                              |
| `.each(table)`                                                                     | One record with `caseCount`, as for Jest; with `expandCases`, each case titled as Bun titles it: `%s` a string, `%d` and `%f` a number, `%i` an integer, `%j` and `%o` JSON, `%#` the index, `%%` a `%`, and `$key` a value of an object case, quoted before Bun 1.3. A value of another type leaves its placeholder as written, and once the values are used up, the rest stays as written. `%p`, and `$key` of an object, keep the cases as one record. A table that isn't an array is an `invalid-chain` error: Bun fails the file. |
| `test(title)` without a function                                                   | A `test-without-body` error: Bun fails the file. `test.skip(title)` and `test.todo(title)` are allowed; `test.todo` with a function is todo too.                                                                                                                                                                                                                                                                                                                                                                                       |
| `beforeAll`, `afterAll`, `beforeEach`, `afterEach`                                 | Hooks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

A `.only` makes Bun run only the focused tests of its file, and from 1.3 with `--only`, none of the files without one;
from 1.3, with `CI=true`, as in GitHub Actions, it fails its file instead. The other tests of the file are listed as
written, with `isOnly` on the focused ones.

## In every runner

- Tests in loops, conditions and plain functions are listed with `isInLoop`, `isInCondition` and `isInFunction`.
- A test or describe declared inside a test body or a hook is not listed, with a `nested-test` warning.
- TypeScript wrappers such as `test!.skip(...)` and `(test as any).only(...)` are read through.
- A test function kept in a variable may be chosen with `?:`, `&&`, `||` or `??`, as in
  `const onCi = process.env.CI && test.skip || test`: only what every choice shares applies.
- `.js`, `.mjs` and `.cjs` files may contain JSX.
