---
'test-inventory': patch
---

Keep unreadable config aliases as dependency gaps rather than silently treating their imports as installed packages.
Read string concatenation and templates in config paths. Follow config aliases in setup paths, Jasmine helper globs,
Cypress's default and configured support files, Bun preload files, and Node script preloads in dependencies and
dependencyHash, so --related keeps tests affected by changes to those files.
