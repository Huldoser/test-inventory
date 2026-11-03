---
'test-inventory': minor
---

`--expand-cases` (library: `expandCases: true`) lists each case of a `.each` or `.for` table and each pass of a loop
whose values the scan can work out as its own record, with the title the runner gives it. Vitest's titles follow the
rules of the project's Vitest version, 3.0 to 5: `%s`, `%d`, `%i`, `%f`, `%j`, `%o`, `%O`, `%c`, `%#`, `%$` and `$name`,
with values quoted and cut as that version does; they match the names Vitest 3.0, 3.1, 3.2, 4.0, 4.1 and 5.0 list.
Each case's values are bound in its callback, so titles, tags and conditions built from them are worked out per case,
and an `if`, `?:`, `&&`, `||` or `??` they decide registers only the branch it takes. Loops in test and hook bodies
and loops over a `var` are not expanded, and a file expands up to 1,000 loop passes and describe cases.
Suites and tests have a new key, `caseIndex`: the case's index from 0, as `%#` counts, or `null` without the option. A
table that can't be expanded stays one record with a new `cases-not-expanded` warning. Without the option the output
is as before, apart from `caseIndex: null` on every suite and test.
