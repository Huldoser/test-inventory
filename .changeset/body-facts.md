---
'test-inventory': minor
---

Tests say what their body does: `fixtures` (the names the test and the `beforeEach`, `afterEach` and `aroundEach` hooks around it take from the context, without Vitest's own keys), `expectCount` (`expect()`, `expect.soft()` and `expect.poll()` calls in the body), Vitest's `expect.assertions(n)` and `expect.hasAssertions()` as `expectedAssertions` and `expectsAssertions`, `hasEmptyBody`, and Playwright's `test.step()` titles in `steps`. Vitest's `annotate()` from the test context adds annotations. Vitest 5 benchmarks, in `*.bench.ts` files or using the `bench` fixture, have `isBenchmark` and a `benchmarkCount` in the summary. New warnings: `empty-title` for a test or describe titled `''`, and `bench-outside-benchmark-file`.
