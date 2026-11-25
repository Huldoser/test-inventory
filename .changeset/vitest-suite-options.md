---
'test-inventory': patch
---

Match Vitest's version-specific handling of inherited only, skip and todo options, including their precedence over configured tags in Vitest 4.1. Report the suite that supplied a test's todo state when nested suites have different modes.

Report forbidden focus from a configured tag and check it before a test body or hook can skip.

Follow Vitest's nested focus selection from 4.0.17 when reporting `isOnly` on siblings.

Honor nested `fails: false` options and version-specific tag precedence when reporting expected failures.
Preserve a test's failure expectation when a focus tag makes it run.

Report Vitest concurrency from nested suite options, modifiers, tags and the root scheduling default through Vitest 4 and the selected project's default from Vitest 5, including the change to `concurrent: false` in 4.1.6 and the removal of the `sequential` option in Vitest 5.

Keep the table declaration and report a warning when Vitest projects sharing a file generate different case titles.

Report when a runtime title-length setting prevents the scan from determining a Vitest case name.
