---
'test-inventory': patch
---

Follow a helper called on the module that exports it, as `checks.validatesQuantity('buy')` after `import * as checks from './checks'` or `const checks = require('./checks')`, instead of leaving out the tests it declares without a warning.
