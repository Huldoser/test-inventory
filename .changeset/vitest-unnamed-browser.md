---
'test-inventory': patch
---

Without patterns, list the files of a Vitest browser config whose instance's `browser` or `name` the scan can't work out, as `instances: [{ browser: process.env.TEST_BROWSER || 'chromium' }]`, with their tests' `projects` `null` and a warning, instead of finding no files: the instances only name the projects.
