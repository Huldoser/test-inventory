---
'test-inventory': patch
---

From Playwright 1.65, `test.skip('reason')`, `test.fixme('reason')` and `test.fail('reason')` with only a string give
that string as the record's `reason`, in a test body and at file or describe level, and no longer a `skip-without-body`
warning, as Playwright 1.65 takes the string as the description. An empty string still applies nothing. Older versions
keep the old reading.
