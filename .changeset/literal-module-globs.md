---
'test-inventory': minor
---

Track files selected by relative literal Vite module globs in Vitest scans. Test records store the pattern groups in `dependencyGlobs`, so filtering a saved inventory can select tests for newly added or deleted matching files. Node ESM imports with a fixed relative filename and a dynamic query now track the source file.
