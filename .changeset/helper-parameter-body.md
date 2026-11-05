---
'test-inventory': patch
---

A helper that takes a test's function as a parameter, as `function settlementTest(desk, body) { describe(desk, () =>
test('settles', body)); }`, no longer gets a false `nested-test` warning. The scan read the parameter as the helper
itself, and so read the helper's own describe as declared inside the test.
