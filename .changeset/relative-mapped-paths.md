---
'test-inventory': patch
---

A `dependency-not-followed` warning for an import a config maps to a file that doesn't exist gives that file's path
relative to the root, as every path in the output is. It gave the absolute path, as `path.resolve()` or `<rootDir>`
built it, so the output differed from machine to machine.
