---
'test-inventory': patch
---

Count a config a package.json script starts Vitest, Jest, Playwright, Cypress or WebdriverIO with, as `vitest run --config vitest.config.integration.mts`, when deciding whether a file runs, so its files no longer get `file-not-run`. Vitest and Cypress read its globs from the folder the script runs in, the others from the config's folder. A config the scan can't read, such as a variable, gives a `config-value-unknown` warning on the package.json in place of `file-not-run`.
