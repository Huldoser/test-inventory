---
'test-inventory': patch
---

Respect a root Mocha script's file selection during discovery. A script that names its specs no longer picks up unrelated files directly under `test/` through Mocha's default spec.
