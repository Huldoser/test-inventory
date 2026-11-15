---
'test-inventory': patch
---

Report a test object that local files build from or re-export from another runner's module, as `@playwright/test` fixtures imported by a file a Jest config runs, as a `framework-mismatch` that names the chain, instead of an `unresolved-test-import` error saying the module is not a local file.
