---
'test-inventory': patch
---

Without patterns, node:test files are also found through the `node --test` scripts of each `package.json` below the root, run from its folder, as a monorepo's packages run their own; before, only the root's scripts counted, and a root script that named its own files hid every package's tests.
