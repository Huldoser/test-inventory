---
'test-inventory': patch
---

Report a `framework-mismatch` at the call to a helper whose test object comes from another of the project's modules that builds it from another runner's package, as `import { test } from './fixtures'` where the fixtures extend `@playwright/test`, instead of an `internal-error` for the whole file.
