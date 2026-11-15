---
'test-inventory': patch
---

Read Playwright's `test.skip`, `test.fixme` and `test.fail` with a body passed by name as a test, as in `test.skip('applies the short-sale rule on ' + venue, checkShortSale)`. With a title the scan couldn't work out, the call was read as `test.skip(condition, description)`: the test was missing and the other tests of its describe were listed as skipped under that condition.
