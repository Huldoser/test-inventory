---
'test-inventory': patch
---

Apply Jasmine's empty-suite rules by version and allow unused callback arguments on focused and skipped suites.
Recognize suites whose spec declarations cannot run, and account for code evaluated in hook arguments.
Mark specs registered after a nested Jasmine declaration error as not loaded, with their earlier siblings and recovery paths preserved.
