---
'test-inventory': patch
---

Work out a property of an object on its own, as `TITLES.fill` when `TITLES` also holds a function, or `fees.MINIMUM` on a module loaded with `const fees = require('./fees')` that also exports a value the scan can't work out. One such value made every property of the object unknown, so titles, tables and tags read from it kept their source text.
