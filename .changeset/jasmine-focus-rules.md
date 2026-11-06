---
'test-inventory': patch
---

Jasmine: an `xdescribe` inside an `fdescribe` stays skipped, as in Jasmine, where the scan listed its specs as active;
a focus inside the `xdescribe` still runs. WebdriverIO on Jasmine now follows Jasmine's focus rules: a `fit` inside an
`xdescribe` runs, and in an `fdescribe` with a `fit` below it only the `fit` has `isOnly`, where the scan applied
Mocha's rules.
