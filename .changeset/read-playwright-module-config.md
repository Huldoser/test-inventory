---
'test-inventory': patch
---

Recognize defineConfig on Playwright's original package export, including default and CommonJS imports, instead of reporting an invalid-chain error that marks the file's tests notLoaded. Keep extended test functions distinct from the package export.
