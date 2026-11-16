---
'test-inventory': patch
---

Tests a helper registers when it is called from a describe in a function nothing in the file calls get the `test-in-function` warning, as the tests written in that function do: the runner registers none of them until that function is called, and they were listed as if it did. A helper in the same file is listed where it is written, the same whether it comes before or after that function; before, one written after it was listed at the call without a warning, and one written before it was listed in both places. An imported helper is listed at the call, with the warning.
