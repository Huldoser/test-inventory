---
'test-inventory': patch
---

A test or describe function chosen in place, as in `(process.env.CI ? it.skip : it)('books a fill', ...)` or
`(process.env.CI && it.skip || it)(...)`, is read as one kept in a variable: only what both choices share applies. The
scan dropped these tests without a warning, for every runner but Playwright, whose case is still open. Jasmine
variables that hold `xit`, `fit`, `xdescribe` or `fdescribe`, as `const later = xit`, keep the `x` or `f`, as the docs
said; their tests were dropped too.
