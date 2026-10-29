---
'test-inventory': patch
---

`dependencyHash` now follows what a Vue or Svelte single-file component imports, also the components and helpers only
its template uses, so a change to a child component changes the hash of the tests that mount its parent. A component
whose script doesn't parse is still taken by its text, and its tests get `hasUnfollowedDependencies`.
