---
'test-inventory': patch
---

Bun: a test whose function is passed by name, followed by a timeout or options, as in
`test('reprices a basket', repricesBasket, 5_000)`, is read as a test. The scan took the timeout for the function and
reported a `test-without-body` error, listing every test in the file as not loaded, though Bun runs them.
