---
'test-inventory': minor
---

Each file record has a new `config` key: the config the file uses, as the runner started at the root would pick it.
That is the outermost config at or above the file that runs it, and for Vitest `projects` the project that does,
read from Playwright's `testDir`, `testMatch`, `testIgnore` and `.gitignore` files, and from Vitest's `include`,
`exclude`, `includeSource`, `typecheck.include` and `benchmark.include` with each version's defaults. Before, the
nearest config was taken, which is wrong for a root config whose `include` covers packages that have their own
`vite.config.ts`. A file with tests that no config runs gets the new `file-not-run` warning.

The globals check follows the same choice, so a test in a folder project without a config of its own gets Vitest's
defaults, and a test the root config runs takes the root's `test.globals`. Files named by `benchmark.include` are
marked `isBenchmark`, in place of the default `*.bench.*` and `*.benchmark.*` names. The config reader now reads
regular expressions and paths built from `__dirname`, `__filename` or `import.meta` with `path.join()`,
`path.resolve()`, `path.dirname()`, `fileURLToPath()` and `new URL()`.
