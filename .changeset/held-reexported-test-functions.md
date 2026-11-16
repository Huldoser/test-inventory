---
'test-inventory': patch
---

Follow a test function a local module exports again, as `module.exports = { test }` after `require('@jest/globals')` or `export { test } from 'vitest'`, when a condition or a function chooses it, as in `return open ? test : test.skip` or `(isCI ? it : it.skip)('title', fn)`. The bare name was followed to its module only in a call shaped like a test, so when it came first in such a choice, the call declared no test, without a warning. Playwright already followed it.
