---
'test-inventory': patch
---

Read a config that calls a function it declares or imports by name from a local file, as `export default createVitestConfig('node')`, as what that function returns. Without globs, also find the files a package.json script's config runs when no config found by name runs them, or the one there can't be read. The AI SDK repository, whose packages are configured this way, now scans as 19,693 tests instead of 1,186.
