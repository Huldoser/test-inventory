---
'test-inventory': patch
---

Test files reached through a symbolic link are read the way each runner reads them. Jasmine and Bun follow such links
and run the file once, as Vitest and Mocha do, so the file is no longer left out; Bun names it by its own path, as its
reports do. node:test runs a linked file, twice when its own path matches too, but a wildcard in its pattern doesn't
enter a linked folder. The `symlink-ignored` warning now names the runner in use, where it named Playwright for every
runner but Jest.
