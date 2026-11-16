---
'test-inventory': patch
---

Keep a backslash in a file name on Linux and macOS, where it is no folder separator: a fixture named `file \slash.js` failed the whole scan with `ENOENT`.
