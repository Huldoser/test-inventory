---
'test-inventory': patch
---

Read the runner version from an npm 5 lockfile that records a package's tarball, as `"version": "https://registry.npmjs.org/jest/-/jest-20.0.4.tgz"`, instead of failing the scan with a `TypeError`; a locked git dependency now falls through to the version package.json declares.
