---
'test-inventory': patch
---

Mocha, Cypress and WebdriverIO on Mocha: `this.skip()` in an `afterEach` hook no longer marks the tests as skipped.
The test has passed by the time the hook runs, and Mocha reports it as a pass.
