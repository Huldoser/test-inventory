---
'test-inventory': minor
---

Workspace packages are followed before an install, from the `workspaces` of `package.json` or from `pnpm-workspace.yaml`. When a package's `exports`, `types` or `main` point to build output that doesn't exist yet, as in `dist/esm/index.js`, the source next to it in `src/` is used. Patterns and links that lead out of the workspace folder are not followed.
