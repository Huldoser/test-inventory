---
'test-inventory': patch
---

A call the runner refuses, such as `test.only.skip(...)`, that is only reached under a condition no longer marks every
test of its file `notLoaded`, as the file loads unless the condition holds; the call is still reported. A test function
chosen with `&&`, `||` or `??`, as in `const onCi = process.env.CI && test.skip || test`, is read like one chosen with
`?:`. In a config, a list with a spread the scan can't work out keeps the items it can.
