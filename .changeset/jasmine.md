---
'test-inventory': minor
---

Jasmine 4 and newer: `--framework jasmine`, also found from a `jasmine` or `karma-jasmine` package or a
`spec/support/jasmine.*` config. The scan reads `describe`, `it` and their `x` and `f` forms with Jasmine's focus, a
spec without a function as pending, `pending(reason)` in a spec or its `beforeEach` or `afterEach`, from Jasmine 7
`notApplicable(reason)`, the hooks, and a spec's timeout. The config's `spec_dir` and `spec_files`, with `!`
exclusions, decide the files; without a config, as in Karma and Angular projects, the files given by glob run. A call
Jasmine refuses stops the whole run at the top level of a file, and is an error that leaves the file's tests as they
are inside a describe, which Jasmine catches.
