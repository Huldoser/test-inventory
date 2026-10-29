---
'test-inventory': minor
---

Each test now has a `dependencyHash` of everything it runs in the project, beside the unchanged `bodyHash`: its own call
with its options, the hooks, `test.use()` and options of its file and of every describe around it, the fixtures it,
those hooks, conditions and `test.use()` values ask for, with the fixtures those ask for, `auto` ones and overrides of
Playwright's own, through every `extend()` and `mergeTests()`, the file's other top-level code, the config and the
configs it builds on, setup files, global setup and teardown, and the Playwright setup projects the test runs after, and
the functions, classes, constants and modules all of these use, followed by scope and through imports, re-exports,
barrels, `require()`, `import()` and Vitest's `vi.mock()` with a fixed path, with the code each module runs when it
loads. A helper that declares the test is in it with the arguments of the call that declares it, so two calls give two
hashes. Formatting and comments don't change it, nor does moving the test. Installed packages are left out, and types
too, except for type tests.

`dependencies` lists the files that went into the hash. When the test reaches something the scan can't follow, a local
file that is missing or doesn't parse, an import with a path worked out at run time or a pattern, or a value only a
declaration file describes, `hasUnfollowedDependencies` is `true` and the new `dependency-not-followed` warning says
where, once per place.
