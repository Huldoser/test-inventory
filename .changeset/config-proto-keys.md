---
'test-inventory': patch
---

A `__proto__` key in a `bunfig.toml` or `.mocharc.yml` is read as a plain key, as Bun and Mocha read it. A
`bunfig.toml` with a `[__proto__]` table changed `Object.prototype` for the whole process, so every later scan in it,
such as those of a long-running MCP server, read settings the project never set. A `.mocharc.yml` one gave its map the
settings inside it. TOML keys named `constructor` or `toString` are read too, where they were refused.
