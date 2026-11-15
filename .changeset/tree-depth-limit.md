---
'test-inventory': patch
---

Report a file whose expressions nest more than 1,000 deep, as a chain of thousands of `+` or calls, as a `parse-error`, as brackets nested more than 500 deep already are, instead of an `internal-error` when the scan's walk overflows the stack. The deepest of 447,597 test files in 2,500 popular projects nests 270.
