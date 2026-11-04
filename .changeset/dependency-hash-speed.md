---
'test-inventory': patch
---

`dependencyHash` is faster on large projects: the files a test file and its describes reach are put together once for
all their tests, and a workspace's packages are found once, not once per folder that imports one. A scan of the Nx
repository with 17,571 tests went from 19.4 to 11.9 seconds. Hashes are unchanged.
