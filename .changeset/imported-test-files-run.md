---
'test-inventory': patch
---

Don't report `file-not-run` for a file that a collected test file imports, such as a shared suite, as its tests run in that file.
