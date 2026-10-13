---
'test-inventory': minor
---

A custom `test` object is followed through as many files as it takes: a fixtures file may re-export it, as in `export * from './base'`, or build it with `extend` on one imported from another file. When it can't be followed, the `unresolved-test-import` message says where the chain of files ends. A test file that builds its own test object from an imported one, as in `const test = base.extend({...})`, no longer gets a `local-test-object` warning when the import is followed.
