---
'test-inventory': patch
---

`expectCount` counts Playwright's `expect.configure(...)`, called in place as `expect.configure({ timeout: 5_000 })(locator)`
or kept in a variable as `const slowExpect = expect.configure(...)`; it missed both.
