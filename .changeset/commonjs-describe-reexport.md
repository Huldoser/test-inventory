---
'test-inventory': patch
---

Follow a describe function a local CommonJS module takes from its runner and exports again, as `module.exports = { describe, it }` after `const { describe, it } = require('@jest/globals')`, and one it exports under another name, as `module.exports.suite = describe`. The module was reported as exporting no test object, so `describe.skip` there didn't skip its tests and their suite was missing.
