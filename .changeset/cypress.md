---
'test-inventory': minor
---

Cypress 13 and newer: `--framework cypress`, also found from a `cypress` package or a `cypress.config.*` file. Tests are
read as Mocha's, with Cypress's test config before the function: `retries`, of which `cypress run` takes `runMode`,
`browser` as a skip condition, `@cypress/grep`'s `tags`, and from Cypress 16 an error for `env`, which Cypress refuses
there. `this.timeout()` and `this.retries()` are not read, as Cypress doesn't take them. The config's testing types are
the projects, `e2e` and `component`, each with its `specPattern`, `excludeSpecPattern` and `retries`.
