---
'test-inventory': patch
---

An inline Vitest project in `test.projects` now runs from the config's `test.root` or `root` when it sets none of its
own, as every Vitest version does; the scan used the config's folder before Vitest 5. A root the project sets is
resolved from the config's root in Vitest 5, as Vitest 5 does, and from the config's folder before.
