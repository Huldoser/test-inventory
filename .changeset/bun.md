---
'test-inventory': minor
---

Bun 1.2.23 and newer: `--framework bun`, also found from a package.json script that runs `bun test` or a
`bunfig.toml`. Its version comes from `.bun-version`, `packageManager` or `engines.bun`, else `@types/bun` or
`bun-types`. The scan reads Bun's globals and imports of `bun:test`, `@jest/globals` and `vitest`, which Bun rewrites;
chains of `.skip`, `.todo`, `.failing`, `.only`, `.concurrent`, `.serial` and `.each` in any order, refusing the
combinations Bun refuses; the conditions `.if`, `.skipIf`, `.todoIf`, `.failingIf`, `.concurrentIf` and `.serialIf`;
options second or third, a number as the timeout or `{ timeout, retry, repeats }`; and `.each` titles as Bun formats
them. The files are Bun's `*.test.*`, `*_test.*`, `*.spec.*` and `*_spec.*` under `bunfig.toml`'s `[test] root`, less
`pathIgnorePatterns`, with its `retry` and `concurrentTestGlob` applied. A small TOML reader reads `bunfig.toml`.

The oldest version a framework supports may now name a patch, as Bun's 1.2.23 does.
