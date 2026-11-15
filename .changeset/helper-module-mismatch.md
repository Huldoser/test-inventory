---
'test-inventory': patch
---

Report another framework a helper's module imports at the helper's call only when the helper uses what it imports, instead of an error saying the scanned file imports it, as when a Bun test builds data with a function from a module of shared helpers that also imports `@playwright/test`.
