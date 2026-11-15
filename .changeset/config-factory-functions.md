---
'test-inventory': patch
---

Read a config built by a function the project writes, as `export default configureE2e({ port: 3002 })` or `module.exports = buildConfig(__dirname, { testRegex })`: one declared in the config or exported by a local file or workspace package is read from its single `return`, with its parameters, their defaults and destructuring set from the call's arguments. Without patterns, such a config found no test files before.
