---
'test-inventory': patch
---

Read the runner version from its own entry in `pnpm-lock.yaml` when an override such as `vitest@5.0.0>happy-dom` comes first, instead of failing the scan with a `TypeError`.
