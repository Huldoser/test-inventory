---
'test-inventory': patch
---

WebdriverIO: a `specs` or `exclude` glob that starts with `!` matches no file, as in WebdriverIO, where the scan took it
to match every other file; a glob that starts with `./` matches from the config's folder only, as its slash keeps glob's
`matchBase` off; from WebdriverIO 10 a capability's `specs` and `exclude` are no longer read, only `wdio:specs` and
`wdio:exclude`; and a capability's settings inside `alwaysMatch` are read.
