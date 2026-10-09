---
'test-inventory': patch
---

Every test in a Vitest file that fails to load is now `notLoaded`, as Vitest runs none of them: a chain Vitest doesn't have, `sequential` or `bench` from Vitest 5, or options as the third argument from Vitest 4. A call to `bench` is reported where it is made, not where it is imported.
