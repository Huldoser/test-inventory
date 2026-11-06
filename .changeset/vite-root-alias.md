---
'test-inventory': patch
---

A Vite alias to a path that starts with `/`, as `alias: { '@': '/src' }`, is followed from the project's root, as Vite
does, so `dependencies` and `dependencyHash` include the files imported through it. The scan looked for `/src` on the
disk, gave a `dependency-not-followed` warning and left the files out.
