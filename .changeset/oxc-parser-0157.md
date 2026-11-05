---
'test-inventory': patch
---

oxc-parser is updated from 0.156.0 to 0.157.0. The scan output doesn't change, except that a `.js` file with
TypeScript-only syntax, such as `export default abstract class` or an optional class member, now gets a `parse-error`, as
Node.js would refuse to load it.
