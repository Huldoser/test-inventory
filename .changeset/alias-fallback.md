---
'test-inventory': patch
---

An import that matches a tsconfig `paths` pattern but none of its files, as an installed package does with
`"paths": { "*": ["./src/types/*"] }`, now goes on to the usual lookup, as TypeScript does. Such imports were reported
as unreadable, so every test that used a package or a built-in module such as `node:fs` got
`hasUnfollowedDependencies`. An `@/` or `~/` alias whose files are missing is still reported.
