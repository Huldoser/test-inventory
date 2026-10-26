---
'test-inventory': patch
---

A hook given a function the file declares, as in `test.beforeEach(skipOnCI)` or `beforeEach(requireBroker)`, is read
like one written in place: the skips, timeouts and other settings it sets apply to the tests it runs before, and its
fixtures are in their `fixtures`. Before, they were missed. A test or hook function passed by name no longer gets a
`state-in-helper` warning saying no test, hook or describe in the file calls it.
