---
'test-inventory': patch
---

`expectCount` now counts `expect.element()`, the assertion of Vitest browser mode, so a browser test that checks the
page only with `await expect.element(locator).toBeVisible()` no longer looks like a test without assertions.
