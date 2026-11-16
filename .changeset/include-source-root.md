---
'test-inventory': patch
---

Read an absolute Vitest `includeSource` entry that names the config's root itself, as `includeSource: [resolve(__dirname, './test')]` with `root: './test'`, as matching no file, as Vitest does, instead of failing the scan with picomatch's `TypeError`.
