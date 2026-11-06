---
'test-inventory': minor
---

node:test on Node.js 22 and newer: `--framework node`, also found from a package.json script that runs `node --test`
or a `node.config.json`. Its version is the Node.js version the project pins in `.node-version`, `.nvmrc`, Volta's
`node` or `engines.node`. The scan reads `test`, `it`, `describe` and `suite` from `node:test`, imported or required,
with `.skip`, `.todo`, `.only` and from 24.14 `.expectFailure`, and the options `skip`, `todo`, `only`, `timeout`,
`concurrency`, `expectFailure` and from 24.19 and 26.2 `tags`; `t.skip()` and `t.todo()` in a test's body; and the
hooks. The files are those the script gives `node --test`, or Node.js's default patterns, with TypeScript files from
22.18.

A test declared in a test's body, with `t.test()` or `test()`, is a subtest that node:test runs while it runs the test:
it is listed with the test's title in `suitePath` and the test's id in the new key `parentTestId`, which is `null` for
every other test.
