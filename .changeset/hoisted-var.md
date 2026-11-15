---
'test-inventory': patch
---

Read a `var` declared in a nested block, such as a `switch` case or an `if` block, as belonging to its whole function, as JavaScript hoists it, so a local `var context` no longer reads as Mocha's `context` and reports an `invalid-chain` error, as in a canvas helper that calls `context.drawImage()`.
