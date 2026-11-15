---
'test-inventory': patch
---

With `expandCases`, stop reporting a Playwright file as failing to load with a `duplicate-title` error when a loop's describe title mixes the loop variable with a value the scan can't work out, as ``test.describe(`${process.env.TRADING_REGION} ${desk} desk`, ...)``. Its source text was the same on every pass, so every test in the file was listed as `notLoaded`, while Playwright's titles differ and it loads the file.
