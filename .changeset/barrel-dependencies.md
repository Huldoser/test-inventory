---
'test-inventory': patch
---

A file that only passes names on, as a barrel `index.ts` with `export * from './fees'` or
`export { OrderTicket } from './order-ticket'` does, is now in the `dependencies` of the tests that import through it,
so `--related` keeps them when the file changes. Which module a re-export points at is now part of `dependencyHash`, as
an import's already was, so the hash of a test that imports through a re-export changes once.
