---
'test-inventory': patch
---

From Playwright 1.64, a project with `default: false` is no longer listed in a test's `projects`, as Playwright runs it
only with `--project`, unless a project that runs lists it in `dependencies` or `teardown`. A `default` the scan can't
work out gets a `config-value-unknown` warning, and the tests it may run get `projects: null`.
