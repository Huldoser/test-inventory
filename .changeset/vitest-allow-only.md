---
'test-inventory': minor
---

A Vitest `.only` that `allowOnly` makes fail is a `forbidden-only` diagnostic, as for Playwright's `forbidOnly`: an
error when the config sets `test.allowOnly` to `false`, and a warning when it is unset, as Vitest then turns it off in
CI, or depends on a condition. Vitest marks such a test failed instead of running it.
