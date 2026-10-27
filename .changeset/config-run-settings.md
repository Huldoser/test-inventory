---
'test-inventory': minor
---

Run settings now come also from the config a file uses: Playwright's `timeout`, `retries` and `repeatEach`, and
Vitest's `testTimeout`, `retry` and `repeats`, where the file sets none. New `timeoutSource`, `retriesSource` and `repeatsSource`
keys say where each value comes from: `test`, `suite`, `file` or `config`, or `null` when nothing sets it. A test
takes the settings of the projects that run it, after their `grep`. When those projects disagree, the config sets the
value under a condition, as in `process.env.CI ? 2 : 0`, or the scan can't work out the projects, the value is `null`
with its source `config`. Playwright's `fullyParallel` and Vitest's `sequence.concurrent` make tests
`isParallel` where the file sets no mode, when every project that runs the test sets it.

A `.only` in a Playwright file whose config sets `forbidOnly` gets the new `forbidden-only` error, since the run then
fails before any test runs. When `forbidOnly` depends on a condition, as in `!!process.env.CI`, it is a warning that
quotes the condition.
