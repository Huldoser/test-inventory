---
'test-inventory': patch
---

States follow the runners' precedence more closely, as checked against Vitest 5.0.4 running generated files. A skip in a test or hook body loses to a fixme, skip or todo set while the file loads, as on a describe around the test, since the body never runs. In Vitest, a test's own options win over its chain, so `test.skip('title', { skip: false }, fn)` is active, but the chain still sets its mode: `test.concurrent('title', { concurrent: false }, fn)` runs in parallel. A describe passes its `skip` option down to the tests and describes inside, where it wins over todo, also when the describe's own `.only` keeps the describe itself from being skipped.
