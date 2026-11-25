---
'test-inventory': patch
---

Count the single fallback test when Jest cannot format a table title, and report the file as not loaded when it happens in a parameterized suite.
Ignore the supplied callback and timeout when Jest rejects an empty or malformed table.
Count the rows that Jest registers when a valid table has a missing or non-callable test callback.
Use the titles Jest registers for functions and undefined values, and mark files with rejected test or suite titles as not loaded.
Account for declarations called without arguments, including the tests registered by parameterized tables.
Read local function and class name properties, including static name fields used in Jest table titles.
Read titles from methods on local object literals and expand table rows when a final explicit property supplies the title.
Mark files as not loaded when Bun rejects an anonymous computed method used as a title with a separate callback.
Resolve titles from local class methods, prototype methods and static fields in initialization order.
Use the Bun version to determine whether a static field gives an anonymous function its test title.
Expand rows titled by inherited methods and use the derived class when the title is its prototype constructor.
Flag titles and table data changed through aliases or shared children of shallow copies, so the inventory does not report stale values.
Track writes and deletes through optional chains and aliases selected by conditional, logical and sequence expressions.
Keep a title readable when a write changes a separate declaration with the same name.
Follow aliases assigned after declaration, including destructuring, and keep earlier captures tied to their original objects.
Flag possible changes to titles through the arguments of local helpers called during test collection.
Follow possible returned objects even when the same helper is called inside its own argument or another branch returns no value.
Follow local constant aliases of functions when collecting tests or tracking writes through helper arguments.
Track possible writes through callbacks passed to local helpers, keeping each callback paired with its own arguments.
Follow callback parameters through local aliases and selection expressions, including defaults when a supplied callback could be missing.
