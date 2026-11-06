---
'test-inventory': patch
---

With `expandCases`, a Vitest case title cuts long values at the length the config sets, `test.taskTitleValueFormatTruncate`
from Vitest 5 and `test.chaiConfig.truncateThreshold` before, as Vitest does; it cut them at Vitest's default, 40, always.
