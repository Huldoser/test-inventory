---
'test-inventory': patch
---

From Playwright 1.57, the config's `tag` is now read: every test gets it first in its `tags`, and a project's `grep` or
`grepInvert` matches it, so a project with `grepInvert: /@nightly/` in a config with `tag: '@nightly'` no longer runs
the tests. When the scan can't work out the `tag`, as for `process.env.CI_ENVIRONMENT_NAME`, it gets a
`config-value-unknown` warning, and the tests of a project with a `grep` get `projects: null`.
