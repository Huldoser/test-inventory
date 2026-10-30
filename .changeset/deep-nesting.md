---
'test-inventory': patch
---

A file with brackets nested more than 500 deep, such as a generated fixture, now gets a `parse-error` instead of
crashing the scan. oxc-parser overflows the native stack on such a file, about 5,000 deep, and the process dies with a
segmentation fault that no error handling can catch, so no inventory was written.
