---
'test-inventory': minor
---

In Playwright, a test in a loop whose title path is the same on each pass gets a `duplicate-title` error, and the tests in its file are `notLoaded`, as Playwright refuses the file. Vitest runs duplicate titles, so nothing changes there.
