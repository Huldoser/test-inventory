---
'test-inventory': patch
---

node:test: a test whose function is passed by name, as `test('fills a market order', fillsMarketOrder)` or
`test(fillsMarketOrder)`, gets that function's `bodyHash`, and without a title the function's name, as Node.js names it.
The scan took the function for the test's options, with an `unresolved-option` warning and no hash, or for a title it
couldn't work out.
