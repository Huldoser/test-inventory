---
'test-inventory': patch
---

A config that `require()`s a local file, as a CommonJS config does with a shared base, now reads what that file
exports, as an `import` of it already did.
