---
'test-inventory': patch
---

Vitest 5 tests follow the option rules of Vitest 5.0.5: the last of `.skip`, `skipIf()` and `runIf()` on a test
decides its skip, so `test.skip.skipIf(false)` is active, and a `skipIf()` or `runIf()` replaces the skip of a tag or of
the options a describe passes down. An option set to `undefined`, as in `test.skip('title', { skip: undefined }, fn)`,
no longer undoes the chain or a tag.
