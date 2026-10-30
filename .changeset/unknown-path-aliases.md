---
'test-inventory': patch
---

An import that starts with `@/` or `~/`, as a Vite `resolve.alias` allows, now gives the test
`hasUnfollowedDependencies` and a `dependency-not-followed` warning when no tsconfig `paths` define it. It was taken for
an installed package, so the aliased file was missing from `dependencies` without a sign, and `--related` left the test
out when that file changed.
