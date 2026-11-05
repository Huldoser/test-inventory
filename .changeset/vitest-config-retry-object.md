---
'test-inventory': patch
---

Before Vitest 4.1, a `retry` object in the config, as `test: { retry: { count: 2 } }`, now gets a
`config-value-unknown` warning that Vitest runs no test with it. The tests already had `retries: null`, but nothing
said why.
