---
'test-inventory': patch
---

Follow a workspace package whose exports point to build output, as `./dist/node.js`, to its TypeScript source in the package folder, as `node.ts`, when it has no `src` folder, as n8n's shared Vitest config package does.
