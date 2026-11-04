---
'test-inventory': patch
---

`require()` of a local file is followed as an import is: tables, titles and other values it exports, with
`module.exports` or `exports.name`, are read, and helper functions it exports that declare tests are followed. A
helper function a shared file imports and exports again, as an `index.js` of helpers does, is followed to where it is
written, instead of getting an `unresolved-test-import` error. A helpers file may export a test function it takes from
the runner's globals, as `export const pendingTest = xit`, or from the framework's module, with its modifiers.
