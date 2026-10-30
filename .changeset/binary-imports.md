---
'test-inventory': patch
---

An imported file that isn't text, such as `import logo from './logo.png'`, is now taken by its bytes in
`dependencyHash`. It was read as text, where every byte that isn't UTF-8 reads the same, so two different images could
give the same hash.
