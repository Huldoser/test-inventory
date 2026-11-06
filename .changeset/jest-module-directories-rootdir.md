---
'test-inventory': patch
---

A `<rootDir>` entry in Jest's `moduleDirectories`, as `['node_modules', '<rootDir>/src']`, is followed as a folder to
look in, as Jest does. The scan looked for a folder named `<rootDir>/src` and left the files out of `dependencies`
without a warning.
