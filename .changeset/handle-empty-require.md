---
'test-inventory': patch
---

Keep declarations when a file or imported helper calls a local function named require without arguments. The value reader no longer turns that call into an internal-error that discards the file's tests. Preserve suite, test and hook roles when members are destructured from an already-bound node:test module.
