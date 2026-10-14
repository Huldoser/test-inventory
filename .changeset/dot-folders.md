---
'test-inventory': patch
---

Globs match folders and files whose names start with a dot, as in `.storybook/` or `.github/scripts/`, as they do in Playwright and Vitest; test files there were left out before. `.git` folders are always left out, like `node_modules`.
