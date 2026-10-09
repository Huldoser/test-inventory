# Supported syntax

## Playwright

Playwright 1.42 and newer.

### Where test comes from

| Form                       | Example                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Named import, also renamed | `import { test } from '@playwright/test'`, `import { test as base } from '@playwright/test'`                   |
| Default import             | `import pwTest from '@playwright/test'`                                                                        |
| Namespace import           | `import * as pw from '@playwright/test'` then `pw.test(...)`                                                   |
| CommonJS                   | `const { test } = require('@playwright/test')`, `require('@playwright/test').test(...)`                        |
| Other packages             | `playwright/test`, `@playwright/experimental-ct-react` and the other component testing packages                |
| Derived                    | `base.extend({...})`, chained `.extend().extend()`, `mergeTests(a, b)`                                         |
| Local fixtures file        | `import { test } from '../fixtures'`, or a path alias, `#` import or workspace package, followed one file deep |

### Calls

| Call                                                                                                                                          | Read as                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test(title, body)`, `test(title, details, body)`                                                                                             | A test. The body may be a function passed by name.                                                                                            |
| `test.only`, `test.skip`, `test.fixme`, `test.fail` with a title and body                                                                     | A test with that state.                                                                                                                       |
| `test.fail.only`                                                                                                                              | Expected to fail, with `isOnly`. Playwright 1.49 and newer.                                                                                   |
| `test.skip()`, `test.skip(condition, description)`, `test.skip(({ browserName }) => condition, description)`; the same for `fixme` and `fail` | At file or describe level, a state for every test in the scope. In a test body or hook, a state for that test or the tests the hook runs for. |
| `test.describe(title, callback)`, with details, or anonymous `test.describe(callback)`                                                        | A describe.                                                                                                                                   |
| `test.describe.only`, `.skip`, `.fixme`, `.serial`, `.serial.only`, `.parallel`, `.parallel.only`                                             | A describe with that state or mode.                                                                                                           |
| `test.describe.configure({ mode })`                                                                                                           | The mode of the describe or file.                                                                                                             |
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

| Form                       | Example                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Named import, also renamed | `import { test, it, describe, suite } from 'vitest'`                                                                        |
| Namespace import           | `import * as vt from 'vitest'` then `vt.test(...)`                                                                          |
| Globals                    | `describe`, `it`, `test` and `suite` used without an import or declaration. A warning says when no config turns globals on. |
| In-source tests            | `const { it, describe } = import.meta.vitest`                                                                               |
| Describe callback          | `describe('fees', (test) => { test(...) })`: Vitest passes its `test` to the callback                                       |
| Derived                    | `test.extend({...})`, `test.extend('name', value)`, chained; `test.override()` and `test.scoped()` are known                |
| Local fixtures file        | `import { test } from './context'`, or a path alias, `#` import or workspace package, followed one file deep                |

### Calls

| Call                                                                                                       | Read as                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `test(title, fn)`, `test(title, options, fn)`, `test(title, fn, timeout)`                                  | A test. Without a function, a todo.                                       |
| `test(title, fn, options)`                                                                                 | Accepted before Vitest 4; a `removed-api` error from Vitest 4.            |
| `.concurrent`, `.only`, `.skip`, `.todo`, `.fails`, in any order and combination                           | `.only` wins over `.skip`, which wins over `.todo`.                       |
| `.each(table)`, `.for(table)`, also as tagged templates                                                    | One parameterized record, with `caseCount` when the table is in the file. |
| `.skipIf(condition)`, `.runIf(condition)`                                                                  | A conditional skip. `runIf(x)` is stored as the condition `!(x)`.         |
| `describe` with `.concurrent`, `.shuffle`, `.skip`, `.only`, `.todo`, `.each`, `.for`, `.skipIf`, `.runIf` | A describe. `describe(title)` without a function is a todo.               |
| `describe(fn)` without a title                                                                             | A `describe-not-called` error: Vitest never calls the function.           |
| `context.skip()`, `skip(note)`, `skip(condition, note)` in a test, `beforeEach` or `aroundEach`            | A state for that test, or for the tests in the describe.                  |
| Options `skip`, `only`, `todo`, `fails`, `concurrent`, `sequential`, `shuffle`, `tags` (4.1), `meta`       | Read when written in the file.                                            |
| `// @module-tag name`                                                                                      | A tag on every test in the file, from Vitest 4.1.                         |
| `.sequential`                                                                                              | The default mode before Vitest 5; a `removed-api` error from Vitest 5.    |
| `bench(...)`, with `bench` imported from `vitest`                                                          | A `removed-api` error from Vitest 5. Benchmarks are never tests.          |
| Any other chain, such as `test.fixme`                                                                      | An `invalid-chain` error.                                                 |

## In both

- Tests in loops, conditions and plain functions are listed with `isInLoop`, `isInCondition` and `isInFunction`.
- A test or describe declared inside a test body or a hook is not listed, with a `nested-test` warning.
- TypeScript wrappers such as `test!.skip(...)` and `(test as any).only(...)` are read through.
- `.js`, `.mjs` and `.cjs` files may contain JSX.
