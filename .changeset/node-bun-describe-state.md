---
'test-inventory': patch
---

node:test and Bun: a skipped describe skips every test inside it, over the test's own todo, as node:test creates none of
them, and in Bun the outermost skipped or todo describe decides, over the describes inside it and the test's own state.
The scan took the state nearest the test, so `test.todo()` in `describe.skip()` was todo, and in Bun `test.skip()` in
`describe.todo()` was skipped.
