---
'test-inventory': minor
---

WebdriverIO 9 and newer: `--framework webdriverio`, also found from a `@wdio/cli` package or a `wdio.conf.*` file. The
config's `config` export, ES or CommonJS, decides the files: `specs`, with the nested lists that group files into one
worker, less `exclude`, matched as WebdriverIO matches them. Its `framework` decides how the tests are read, Mocha by
default or Jasmine, with `mochaOpts.timeout`, `retries` and `ui`, or `jasmineOpts.defaultTimeoutInterval`, on every
test; Cucumber is reported, as its feature files aren't read. A number after a test's function is WebdriverIO's retry
count, and with Jasmine a second one, after the timeout. Mocha's and Jasmine's version gates follow the versions
WebdriverIO depends on. A call the runner refuses fails only its spec file, as WebdriverIO runs each in a worker.

A project whose package.json lists `@wdio/cli` next to another runner now needs `--framework`, as the scan asks for
one whenever it finds several runners.
