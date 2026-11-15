---
'test-inventory': patch
---

Report a file that imports its test functions from another runner's built-in module, as `bun:test` in a node:test or Jest scan, or `node:test` in a Vitest, Jest, Mocha, Jasmine or Playwright scan, as a `framework-mismatch`, as for other runners' packages, instead of an `unresolved-test-import` error saying the module is not a local file. `mocha` is a mismatch in Jest, Vitest and Playwright scans too.
