---
'test-inventory': patch
---

A `#` import or workspace package export whose target repeats the `*` of its pattern, as in
`"#desks/*": "./desks/*/*-fixtures.ts"`, is followed to the file Node.js loads, with every `*` filled in. Only the
first was filled in before, so the import wasn't followed and its tests were missing, with an `unresolved-test-import`
error. A folder given as the pattern with a long run of slashes, as in `tests////unit`, no longer slows the scan down
while the hint for it is written.
