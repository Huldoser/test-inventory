---
'test-inventory': patch
---

Match Vitest's version-specific handling of inherited only, skip and todo options, including their precedence over configured tags in Vitest 4.1. Report the suite that supplied a test's todo state when nested suites have different modes.

Report forbidden focus from a configured tag and check it before a test body or hook can skip.

Follow Vitest's nested focus selection from 4.0.17 when reporting `isOnly` on siblings.

Honor nested `fails: false` options and version-specific tag precedence when reporting expected failures.
