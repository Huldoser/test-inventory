---
'test-inventory': minor
---

Support Vitest 1.0 and newer, from 3.0: Vitest 2 and 1 still have about 15 million weekly downloads, and projects on them got an `unsupported-framework-version` warning. Read from `@vitest/runner` 1.6.1, 2.0.0, 2.1.9 and 3.0.9, their chains are those of Vitest 3 but for `.for`: `test.for` came in 2.0 and `describe.for` in 3.0, and before, each is an `invalid-chain` error, as the call throws and Vitest fails the file. Compared with Vitest 1.6.1, 2.0.5 and 2.1.9 running the strategy fixture: no other difference.
