---
'test-inventory': patch
---

A call through an imported name that reads like a test function is followed, and reported with `unresolved-test-import` when it can't be, also when it goes through a member the scan doesn't know, as in `it.effect('title', fn)` from `@effect/vitest`, or passes a timeout after the body, as in `test('title', fn, 60_000)`. Such tests were missing before, with no diagnostic. A module's own export of a name now wins over the same name passed on by `export *`, as in JavaScript: `export const it = ...` next to `export * from 'vitest'` is no longer read as Vitest's `it`.
