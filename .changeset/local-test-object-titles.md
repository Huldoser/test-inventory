---
'test-inventory': patch
---

Follow a test function or describe imported from a local file whatever the title of the call that uses it first, as `test(TITLES.fill, fn)` with `test` from a fixtures file, or `describe(DESK, fn)` with Vitest's `describe` re-exported by a local module. Such a call was left out, and the tests in such a describe lost it, unless an earlier call in the file wrote its title in place.
