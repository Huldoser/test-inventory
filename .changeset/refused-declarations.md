---
'test-inventory': patch
---

A call the runner refuses that is written like a declaration, as `describe.sequential('title', fn)` in Vitest 5, `test('title', fn, { retry: 2 })` from Vitest 4 or `test.only.skip('title', fn)`, is listed as a plain test or describe without the part that fails. Its tests were missing before; now they are `notLoaded`, like every other test in the file.
