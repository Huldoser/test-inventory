---
'test-inventory': minor
---

Run settings now come also from the config a file uses: Playwright's `timeout`, `retries` and `repeatEach`, and
Vitest's `testTimeout` and `retry`, where the file sets none. New `timeoutSource`, `retriesSource` and `repeatsSource`
keys say where each value comes from: `test`, `suite`, `file` or `config`, or `null` when nothing sets it. When the
projects that run a file disagree, or the config sets the value under a condition, as in `process.env.CI ? 2 : 0`, the
value is `null` with its source `config`. Playwright's `fullyParallel` and Vitest's `sequence.concurrent` make tests
`isParallel` where the file sets no mode.

A `.only` in a Playwright file whose config sets `forbidOnly` gets the new `forbidden-only` error, since the run then
fails before any test runs. When `forbidOnly` depends on a condition, as in `!!process.env.CI`, it is a warning that
quotes the condition.
