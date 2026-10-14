---
'test-inventory': patch
---

Workspace packages are found from both `pnpm-workspace.yaml` and the `workspaces` of `package.json`. When a repository had both, as after a move to pnpm that kept the old list, only `package.json` was read, and a package listed only in `pnpm-workspace.yaml` got an `unresolved-test-import` error.
