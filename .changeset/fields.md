---
'test-inventory': minor
---

`--fields` keeps only the named keys of each test, and `id`, as in `--fields fullName,reason`, so a short question gets a short answer. Output written with it leaves keys out, so it no longer matches the JSON Schema. The library exports the same as `pickTestFields()`.
