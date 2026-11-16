---
'test-inventory': patch
---

Read `test(title, checkFill, 10_000)`, a body passed by name before a timeout, as a call shaped like a test, as `test(title, () => {}, 10_000)` already was. A test object a local module exports again was followed to that module only after such a call, so when it was the file's first test through that name, it declared nothing, without a warning.
