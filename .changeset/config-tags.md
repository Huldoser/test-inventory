---
'test-inventory': minor
---

Vitest tags the config defines in `test.tags` now apply to the tests that carry them, as Vitest applies them. Their
`skip`, `todo`, `fails` and `only` are merged with the test's own and those a describe passes down, and Vitest's order,
`only` over `skip` over `todo`, gives the state, with the new `stateSource` value `config` when a tag sets it. Their
`concurrent`, `timeout`, `retry`, `repeats` and `meta` set those keys where the test sets none: from Vitest 5 over a
describe's options, and in Vitest 4.1 under them. The lowest `priority` wins between tags, and a Vitest 5 project's
own `tags` replace those of the config it extends.

A tag the config doesn't define fails the file in Vitest unless `strictTags` is off, also when there is no config, so
it now gets the new `undefined-tag` error, and the file's tests are `notLoaded`; in a function or under a condition it
is a warning, as that code may not run. The `config-may-change-state` warning now shows only when
the scan can't work out the config's tags.
