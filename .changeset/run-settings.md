---
'test-inventory': minor
---

Tests and describes have their run settings: `timeout`, `isSlow` and `slowCondition`, `retries`, `retryDelay`, `retryCondition` and `repeats`. Playwright's come from `test.describe.configure({ timeout, retries })`, `test.setTimeout()` and `test.slow()` in a describe, a `beforeEach` or the test body; Vitest's from the `timeout`, `retry` and `repeats` options, the timeout after the body, and the options a describe passes down. A test gets the value from the nearest place that sets it, and `null` when the file sets none, so the config decides. A timeout that can't be worked out, or that is set only under a condition, gets an `unresolved-option` warning.
