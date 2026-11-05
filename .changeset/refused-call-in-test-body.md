---
'test-inventory': patch
---

A test or describe call the runner refuses, written inside a test or hook body, is now a `nested-test` warning, not
an error that says the runner fails the file. Jest's own suite calls `it('test1')` inside `expect(() => ...)` to test
that error; the call runs in the test, so the file loads and its tests run.
