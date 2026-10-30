---
'test-inventory': patch
---

An import that matches a tsconfig `paths` pattern but none of its files, as an installed package does with
`"paths": { "*": ["./src/types/*"] }`, now goes on to the usual lookup, as TypeScript does. Such imports were reported
as unreadable, so every test that used a package got `hasUnfollowedDependencies`. An alias whose files are missing, with
nothing else to fall back on, is still reported.
