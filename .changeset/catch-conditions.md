---
'test-inventory': patch
---

A skip in a `catch` block, such as `context.skip()` when a test server can't start, is conditional, with the `catch` clause as its condition, as in `catch (error)`. It was recorded as an unconditional skip before. A test declared in a `catch` block gets `isInCondition: true`.
