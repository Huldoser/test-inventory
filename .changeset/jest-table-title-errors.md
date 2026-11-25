---
'test-inventory': patch
---

Count the single fallback test when Jest cannot format a table title, and report the file as not loaded when it happens in a parameterized suite.
Ignore the supplied callback and timeout when Jest rejects an empty or malformed table.
Count the rows that Jest registers when a valid table has a missing or non-callable test callback.
Use the titles Jest registers for functions and undefined values, and mark files with rejected test or suite titles as not loaded.
Account for declarations called without arguments, including the tests registered by parameterized tables.
Read local function and class name properties, including static name fields used in Jest table titles.
