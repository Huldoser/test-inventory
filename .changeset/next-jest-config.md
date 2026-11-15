---
'test-inventory': patch
---

Read Jest configs built with next/jest's `createJestConfig(config)`, as the Next.js guide writes them, with the mocks and ignored folders next/jest adds, so their test files are found and their imports followed. Leave out a name Jest's `moduleNameMapper` maps to an installed package, such as `identity-obj-proxy`, as an imported package is, instead of reporting it as unfollowed.
