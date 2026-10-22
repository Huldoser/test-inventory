---
'test-inventory': minor
---

The output has a record for each scanned file in `files`, and counts hooks: `hooks` on a file holds the hooks at its top level, on a describe the hooks registered in it, and on a test every hook that runs around it, by kind (`beforeAll`, `beforeEach`, `afterEach`, `afterAll`, and Vitest's `aroundEach` and `aroundAll`). Hooks a helper function registers count where it is called. JSON Lines output has a `file` line for each file, and a filtered inventory keeps the files of the matched tests and the files without tests.
