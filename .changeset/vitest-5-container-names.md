---
'test-inventory': patch
---

In Vitest 5, the projects of a config that another config lists in `projects` are named inside that config's name, as
Vitest names them: the `unit` project of `apps/web/vitest.config.ts`, named `web`, is `web (unit)`.
