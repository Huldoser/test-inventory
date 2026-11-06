---
'test-inventory': patch
---

Mocha: a `.only` in a project whose config sets `forbid-only` (or `forbidOnly`) gets a `forbidden-only` error, as Mocha
stops the run before any test runs, or a warning when the setting depends on a condition, as Playwright's `forbidOnly`
does.
