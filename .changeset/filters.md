---
'test-inventory': minor
---

Filters keep only the tests a question is about: `--state`, `--tag`, `--grep` (a regular expression on the full name, ignoring case), `--only` and `--without-reason`, as in `--state skip --state fixme` for the tests that don't run. The output then describes only those tests: the describes around them, their diagnostics and a summary counted over them. The library exports the same as `filterInventory()`.
