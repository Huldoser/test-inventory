---
'test-inventory': patch
---

From Vitest 5, `timeout: undefined`, `retry: undefined` and `repeats: undefined` in a test's options are left out, as
Vitest leaves them out, instead of giving an `unresolved-option` warning that `undefined` is not a whole number.
