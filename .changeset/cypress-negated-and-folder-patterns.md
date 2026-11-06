---
'test-inventory': patch
---

Cypress: `specPattern` and `excludeSpecPattern` are read as globby, which Cypress uses, reads them. A `specPattern` that
starts with `!` leaves files out, where the scan took it to match every other file and listed nearly the whole project;
an `excludeSpecPattern` drops its `!`, where the scan left out everything else; and a folder in either stands for every
file below it, where it matched nothing.
