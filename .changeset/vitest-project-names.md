---
'test-inventory': patch
---

A Vitest project without a `test.name` now has the name Vitest gives it, in `projects` and in `configs`: the `name` in
the package.json of its folder, else the folder's name, so `projects: ['packages/*']` names its projects
`@trading/pricing` or `ledger` instead of `""`. An inline project without a name is named after its place among the
inline projects, as `0`, and in Vitest 5 no longer takes the name of the config it extends.
