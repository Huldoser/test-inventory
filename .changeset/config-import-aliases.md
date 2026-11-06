---
'test-inventory': minor
---

`dependencyHash` follows imports through the config a file runs with: Vite's `resolve.alias` and Vitest's
`test.alias`, as an object or a list of `{ find, replacement }` with a name or a regex, and Jest's `moduleNameMapper`,
`modulePaths` and `moduleDirectories`, with `<rootDir>`. They were read from tsconfig `paths` only, so tests that
imported through such aliases had `hasUnfollowedDependencies` and a hash that missed those files. A mapping to no file
is a `dependency-not-followed` warning that names it.
