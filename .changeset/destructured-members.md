---
'test-inventory': patch
---

A name destructured from a test object, as in `const { describe, beforeEach } = test`, is now read as that member:
`beforeEach(...)` is a hook, `describe(...)` a describe and `skip(...)` a skipped test, for Playwright and Vitest,
also nested, as in `const { describe: { serial } } = test`. Every such name was read as `test` itself, so a hook got
`test-without-body` and every test of the file `notLoaded`, and the tests inside a describe were left out with
`nested-test` warnings.
