---
'test-inventory': patch
---

A fixtures file that builds its test object with a function, written there or imported from another file, as in `export const test = defineDeskTest('equities')`, is followed: MSW's test files import such a `test`. Their tests were missing before, with no diagnostic when the fixtures file didn't import the framework itself. A test object built with a call the scan can't follow now gets an `unresolved-test-import` error that names the call, as in "builds it with withWarmup(), which is not followed". A function that returns what another function returns, as `() => onFeed('NYSE')`, is followed too.
