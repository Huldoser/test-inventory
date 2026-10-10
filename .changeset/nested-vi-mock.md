---
'test-inventory': patch
---

From Vitest 5, a file that calls `vi.mock`, `vi.unmock` or `vi.hoisted` anywhere but its top level gets a `removed-api` error at the call, and its tests are `notLoaded`, as Vitest refuses the file. Files with in-source tests are not checked, as in Vitest.
