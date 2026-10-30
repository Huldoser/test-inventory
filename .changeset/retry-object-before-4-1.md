---
'test-inventory': patch
---

A Vitest `retry` object in a test's or describe's options before Vitest 4.1 now gets an `unresolved-option` warning
and `retries: null`. Vitest 4.0 and 3.2 never run such a test; the scan used to ignore the object and give the
config's retry count instead.
