---
'test-inventory': minor
---

Tests and describes declared in a helper function are recorded at each call of the helper from the file or a describe, in the describe around the call, as the runner registers them; before, they were listed once, where written. Titles built from the helper's parameters are worked out from each call's arguments. Helpers imported from other files are followed too: their records give the call in the scanned file as their location, and a new `declaredAt` key on test and suite records gives the file and line where the helper writes the test, `null` for code in the scanned file. Records of tests in helpers get new ids, as their describes change. The `test-in-function` warning now only marks tests in functions the scan can't place.
