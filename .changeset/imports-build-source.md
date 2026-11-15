---
'test-inventory': patch
---

Take a package.json `imports` target in build output, as `"#src/*.js": "./build/*.js"`, from the source next to it, as `src/context/empty.ts`, as workspace packages already are, instead of reporting the import as not read when the project hasn't been built.
