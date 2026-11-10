---
'test-inventory': patch
---

Read context modifiers and subtests in named node:test callbacks, retain valid parent test IDs when callbacks appear before their callers, recognize Windows patterns naming linked node:test folders, and reject TOML inline tables with missing commas.

Stop claiming that Jest runs tests when a required local preset is missing. Config-based discovery returns no files, while explicit globs retain the declarations with a file-not-run diagnostic.
