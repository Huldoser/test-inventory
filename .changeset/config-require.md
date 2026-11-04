---
'test-inventory': patch
---

A config that `require()`s a local file, as a CommonJS config does with a shared base, now reads what that file
exports, as an `import` of it already did, and a JSON file, required or imported, is read as its value.
