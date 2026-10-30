---
'test-inventory': patch
---

Playwright's `defineConfig(base, config)` is now merged as Playwright merges it: a project of `config` merges into the
project of `base` with the same name instead of replacing all of `base`'s projects, and `expect`, `use` and `build`
merge key by key. A setup project from a base config is no longer lost, and an `expect.toHaveScreenshot.pathTemplate`
from the base still marks the tests that compare screenshots with `hasUnfollowedDependencies`.
