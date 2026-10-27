---
'test-inventory': minor
---

Each test record has a new `projects` key: the names of the projects that run the test, of the config its file uses.
For Playwright, those whose `testDir`, `testMatch` and `testIgnore` include the file, less those whose `grep` or
`grepInvert` leaves the test's title and tags out; for Vitest, those whose files include it, with each browser
instance as a project, named as Vitest names it, such as `unit (chromium)`. It is `[]` when no project runs the test,
and `null` without a config or when the scan can't tell. Config records list their projects in `projects`, each with
its `name`, `testDir` and Playwright's `dependencies`.
