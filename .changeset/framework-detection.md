---
'test-inventory': minor
---

`--framework` (library: `framework`) is now optional. Without it, the scan takes the runner the project uses: the one
whose package a `package.json` in the root or below it lists, or whose config file is there, else one a `package.json`
above the root lists. A project with several runners, or none, gets a usage error (a `TypeError` in the library) that
names what it found.
