---
'test-inventory': minor
---

`--format commands` prints, in place of the inventory, a command line for each config that runs the tests kept, with the projects that run them, as `npx playwright test tests/orders/limit-orders.spec.ts --config playwright.config.ts --project chromium webkit`; with `--related`, the tests a change can affect. Each runner gets the files the way it takes them: Jest exact paths with `--runTestsByPath`, Cypress one command for each testing type, Bun paths that start with `./`. Mocha adds files named on its command line to its config's `spec`, so a `#` line above its command says that every spec the config lists runs too. `runCommands()` gives the same commands from the library.
