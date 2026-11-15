---
'test-inventory': patch
---

Follow a module loaded by a path built from string literals and the module's own folder, as `require(path.join(__dirname, 'venues', 'nasdaq.cjs'))`, `import(pathToFileURL(resolve(SUPPORT, 'venues/nyse.ts')).href)` or `import(fileURLToPath(new URL('../support/feeds.mjs', import.meta.url)))`, also through constants, instead of reporting it as worked out at run time. `__dirname`, `__filename` and `import.meta.dirname`, `filename` and `url` are read with `path.join()`, `path.resolve()` with an absolute part, `path.dirname()`, `new URL()`, `fileURLToPath()` and `pathToFileURL()`.
