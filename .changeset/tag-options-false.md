---
'test-inventory': patch
---

A Vitest test's own `skip`, `only`, `todo` or `fails` option now replaces the one its tags set, as Vitest does, so
`test('title', { tags: ['flaky'], skip: false }, fn)` is active instead of skipped, and a conditional `skip` replaces
the tag's unconditional one.
