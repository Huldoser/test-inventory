---
'test-inventory': minor
---

Glob patterns are optional, in `scan()` and on the command line: without them, the test files are those the
Playwright or Vitest configs in the root and the folders below it run, each with the config it uses. A config whose
files the scan can't work out gets a `config-value-unknown` warning that says to give patterns, and a scan without
patterns and without a config says so in `no-files-matched`. An empty list of patterns is still an error.
