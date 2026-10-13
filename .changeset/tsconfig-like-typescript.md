---
'test-inventory': minor
---

Path aliases come from the tsconfig nearest the importing file, as TypeScript finds it, with every file it `extends`, packages included, and `${configDir}` filled in. Without a `tsconfig.json`, the nearest `tsconfig.base.json` is used, as in an Nx workspace, and a solution-style tsconfig takes its aliases from the projects it `references`.
