---
'test-inventory': patch
---

Read a config factory with its parameters set from the call's arguments, their defaults and destructuring included, as `configureE2e({ port: 3002 })` or `module.exports = buildConfig(__dirname, { testRegex })`, and follow one a workspace package exports, a default or CommonJS export, or one passed on from another module. A default written with `??`, `||` or `&&`, as `options ?? {}`, is read when its left side is known.
