---
'test-inventory': patch
---

Follow a workspace package written in JavaScript to its files, as Node loads them: a `main` or `exports` that points to JavaScript outside build folders, as `./index.js`, and a file the package has no `exports` for, as `@lhci/utils/src/presets/all.js`. Tests that import such a package were marked `hasUnfollowedDependencies`, so `--related` kept them for a change to any file, and their `dependencyHash` did not change with the package's code. Built JavaScript with no source next to it is still not followed.
