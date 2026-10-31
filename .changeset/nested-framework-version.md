---
'test-inventory': patch
---

When the root and the folders above it don't have the framework, its version is now read from the shallowest
`package.json` below the root that declares it and holds scanned files, as `code/package.json` in a monorepo, with
that package's lockfile or installed copy first. The version was `null` there, so the newest rules applied: Vitest
5's, which refuse a file that calls `vi.mock` inside a block, made every test of such a file `notLoaded` in a project
on Vitest 3.
