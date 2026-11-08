---
'test-inventory': patch
---

Read locally declared describe callbacks passed by name, preserving suite placement, inherited state, lexical values and expanded table arguments. Keep suite hashes, dependencies and nested parent links complete, including when a child is written before its calling parent. Apply the existing helper traversal limits and runner callback checks to these callbacks.
