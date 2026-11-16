---
'test-inventory': patch
---

`--format commands` and `runCommands()` put `[`, `]`, `*`, `?`, `{` and `}` in a node:test path in brackets, as `test/routes/[[]venue[]]/quotes.test.js`: `node --test` reads its arguments as globs, so a route folder such as `[venue]` ran another file, or none.
