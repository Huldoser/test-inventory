---
'test-inventory': minor
---

Jest 29 and 30: `--framework jest` (library: `framework: 'jest'`) lists the tests of Jest files with the same keys as
Playwright and Vitest tests. It reads Jest's globals, `fit`, `xit`, `xtest`, `fdescribe` and `xdescribe` among them,
imports and `require()` of `@jest/globals`, the chains Jest has, such as `test.concurrent.only.each`, `.failing` as
`expectedToFail`, the timeout passed third, `jest.retryTimes()` as `retries` for every test of the file (from 30.5,
with `entireDescribe`, of its describe) and `waitBeforeRetry` as `retryDelay`, and `@group` pragmas as tags, as
jest-runner-groups reads them. `--expand-cases` titles each case as jest-each 29 and 30 do. Calls Jest refuses, such
as `test.only.concurrent`, `test('title')` without a function or an async describe, mark the file's tests `notLoaded`.

Without globs, the test files come from the Jest config, read as Jest reads it: `jest.config.*`, else `package.json`,
with `roots`, `testMatch`, `testRegex`, the ignore patterns, `moduleFileExtensions`, `projects` named by
`displayName`, `testTimeout` and `injectGlobals`, also through Jest 30.3's `defineConfig()` and `mergeConfig()`;
without any config, Jest's defaults apply. `framework` in the output
can now be `jest`, an open set, so `schemaVersion` stays 1.

The `cases-not-expanded` message no longer names Vitest, as Jest tables can get it too.
