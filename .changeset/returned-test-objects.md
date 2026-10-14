---
'test-inventory': patch
---

Tests on a test object that a function returns are found, as in `conditionalTest({ min: 22 })('title', fn)` or `const quoteTest = onNode(22)`, when the function is declared in the file or imported from a local file. They were missing before, with no diagnostic. When the function returns a different test function on different runs, as `it.skip` or `it`, only the modifiers they all have apply, as for a variable chosen by a condition. When the function can't be followed and its name reads like a test object, as for one from an installed package, the calls on what it returns are read as tests on trust, with a `local-test-object` warning.
