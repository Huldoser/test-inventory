---
'test-inventory': patch
---

Without patterns, keep candidate files for a Vitest config whose project list the scan can't read, as one built with `readdirSync`, a function in `test.projects` or Vitest 3's `test.workspace`: the files the config's own `include` and `exclude` select, with their tests' `projects` `null` and a `config-value-unknown` error that says tests may be missing, as Playwright does. Unknown file selection in Vitest discovery is now an error, as in Playwright's. The entries of a `test.exclude` the scan can read still leave files out beside a spread it can't work out, with a warning, as Jest's ignore patterns do; a `browser.enabled` it can't work out leaves the config's files listed; and a Vitest 3 `test.workspace` the scan doesn't read gets a warning where `test` is written.
