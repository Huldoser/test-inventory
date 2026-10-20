---
'test-inventory': minor
---

`--format jsonl` writes the inventory as JSON Lines: an `inventory` line, one line per suite, test and diagnostic, and a `summary` line, each marked with a `type` key. Tools that read one record per line, such as `grep` or DuckDB, no longer need the whole document in memory. The `InventoryLine` type describes the lines.
