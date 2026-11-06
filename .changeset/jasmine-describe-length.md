---
'test-inventory': patch
---

Jasmine: a describe callback with a TypeScript `this` parameter, a parameter with a default value or a rest parameter,
as `function (this: object)`, is no longer reported as taking arguments. Jasmine checks the function's `length`, which
counts none of these, and runs the specs; the scan listed them as not loaded.
