---
'test-inventory': patch
---

Vitest 5 tests follow the option rules of Vitest 5.0.5: the last of `.skip`, `skipIf()` and `runIf()` on a test
decides its skip, so `test.skip.skipIf(false)` is active, and a `skipIf()` or `runIf()` replaces a tag's skip. An option
set to `undefined`, as in `test.skip('title', { skip: undefined }, fn)`, no longer undoes the chain or a tag.
