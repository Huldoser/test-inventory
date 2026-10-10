---
'test-inventory': patch
---

Locks set with `test.describe.configure({ lock })`, new in Playwright 1.64, are added to every test in the file or describe where the call is made. They were dropped before.
