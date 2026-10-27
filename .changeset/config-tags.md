---
'test-inventory': minor
---

Vitest tags the config defines in `test.tags` now apply to the tests that carry them, as Vitest applies them: `skip`,
`todo` and `fails` set the state, with the new `stateSource` value `config`, and `only`, `concurrent`, `timeout`,
`retry`, `repeats` and `meta` the keys they set. The lowest `priority` wins between tags, the test's own options win
over its tags, and from Vitest 5 the tags win over a describe's options, which win in Vitest 4.1.

A tag the config doesn't define fails the file in Vitest unless `strictTags` is off, so it now gets the new
`undefined-tag` error, and the file's tests are `notLoaded`. The `config-may-change-state` warning now shows only when
the scan can't work out the config's tags.
