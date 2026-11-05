---
'test-inventory': minor
---

Mocha 10 and newer: `--framework mocha`, also found from a `mocha` package, a `.mocharc.*` file or a `mocha` key in
`package.json`. The scan reads `describe`, `context`, `it`, `specify`, their `x` forms, `.only` and `.skip`, a test
without a function as pending, `ui: tdd`'s `suite` and `test`, the hooks, `this.timeout()`, `this.retries()` and
`this.skip()` where `this` is Mocha's, and `.timeout()` and `.retries()` after `it()` and `describe()`. The config's
`spec`, `extension`, `recursive`, `ignore` and `file` decide the files, and its `timeout` and `retries` apply to every
test; a YAML config is read too. A describe without a function, `it()` or `describe()` without a title, and an
unknown chain such as `it.concurrent` are errors, as Mocha then runs no test.

A project whose package.json lists `mocha` next to another runner now needs `--framework`, as the scan asks for one
whenever it finds several runners.
