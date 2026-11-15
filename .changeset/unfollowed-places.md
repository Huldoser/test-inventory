---
'test-inventory': minor
---

Each test has `unfollowedDependencies`: the file and line of each place it reaches that the scan can't follow, as `support/venues.ts:2`, sorted, beside `hasUnfollowedDependencies`. A test that `--related` keeps for such a place now says where, so a reader or an agent can judge whether a change could be what that place loads; one dynamic import in a shared setup file or a config setting the scan can't work out often marks a whole suite. `--fields` can pick it. `diff` ignores the list, as it ignores line numbers; `hasUnfollowedDependencies` still shows a test that starts or stops reaching such code. Inventories saved by earlier versions don't have the key, so scan both revisions again with this version before comparing them.
