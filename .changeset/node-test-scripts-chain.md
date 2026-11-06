---
'test-inventory': patch
---

node:test: the scan reads the `node --test` commands of every script the `test` script runs through `npm run`, `pnpm`,
`yarn`, `bun run`, `npm-run-all`, `run-s` or `run-p`, as in `"test": "npm run test:unit && npm run test:integration"`.
It read only the first script that runs `node --test`, and left out the files of the others without a warning.
