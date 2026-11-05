---
'test-inventory': minor
---

Cypress 13 and newer: `--framework cypress`, also found from a `cypress` package or a `cypress.config.*` file. Tests are
read as Mocha's, with Cypress's test config before the function: `retries`, of which `cypress run` takes `runMode`,
`browser` as a skip condition, `@cypress/grep`'s `tags`, and from Cypress 16 an error for `env`, which Cypress refuses
there. `this.timeout()` is not read, as Cypress has only command timeouts; `this.retries()` in a describe and
`.retries()` after `it()` or `describe()` are errors, as Cypress throws on them while it loads the spec. The config's
testing types are the projects, `e2e` and `component`, each with its `specPattern`, `excludeSpecPattern` and `retries`.

A project whose package.json lists `cypress` next to another runner, as Jest or Vitest for unit tests, now needs
`--framework`, as the scan asks for one whenever it finds several runners.
