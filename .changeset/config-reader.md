---
'test-inventory': minor
---

The output lists the configs the scanned files use in a new top-level `configs` key, and as `config` lines in JSON
Lines. A file uses the nearest `playwright.config.*`, `vitest.config.*` or `vite.config.*` in its folder or a folder
above, up to the root, as the runner started in that folder would. A config is read as code, never run, and `extends`
lists the files it takes settings from through imports, such as a shared base config.

Vitest's globals now come from `test.globals` in the config a file uses, read through `defineConfig()`,
`mergeConfig()`, spreads, constants and imported base configs. Before, any `globals: true` in a Vitest or Vite config
in the file's folder or a folder above counted, also one Vitest doesn't read for the file, as in a `vite.config.ts`
next to a `vitest.config.ts`. So `globals-not-enabled` can now appear where it didn't, and go away where a base config
turns globals on. A `test.globals` the scan can't work out without running the config, and a config it can't read,
get the new `config-value-unknown` warning.
