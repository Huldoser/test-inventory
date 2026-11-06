---
'test-inventory': patch
---

Jest's `moduleNameMapper` replaces the whole import name, as Jest does, also when its pattern matches only part of it,
as `'\\.css$'` does. The scan replaced only the matched part, so a mapped style or file mock was missing from
`dependencies` and its import got a `dependency-not-followed` warning. Vite's aliases still replace only the part they
match.
