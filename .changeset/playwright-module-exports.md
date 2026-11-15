---
'test-inventory': patch
---

Read `playwright.chromium.launch()`, `playwright.request.newContext()` and the other `@playwright/test` exports called through a default or CommonJS import of the package as library calls, as `defineConfig` already was, instead of `invalid-chain` errors that could mark the file's tests as not loaded.
