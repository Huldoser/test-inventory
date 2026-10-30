# test-inventory

## 0.6.1

### Patch Changes

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - An import that matches a tsconfig `paths` pattern but none of its files, as an installed package does with
  `"paths": { "*": ["./src/types/*"] }`, now goes on to the usual lookup, as TypeScript does. Such imports were reported
  as unreadable, so every test that used a package or a built-in module such as `node:fs` got
  `hasUnfollowedDependencies`. An `@/` or `~/` alias whose files are missing is still reported.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - A file that only passes names on, as a barrel `index.ts` with `export * from './fees'` or
  `export { OrderTicket } from './order-ticket'` does, is now in the `dependencies` of the tests that import through it,
  so `--related` keeps them when the file changes. Which module a re-export points at is now part of `dependencyHash`, as
  an import's already was, so the hash of a test that imports through a re-export changes once.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - An imported file that isn't text, such as `import logo from './logo.png'`, is now taken by its bytes in
  `dependencyHash`. It was read as text, where every byte that isn't UTF-8 reads the same, so two different images could
  give the same hash.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - A `<script>` block in a Vue or Svelte component whose `type` isn't JavaScript, such as
  `<script type="application/ld+json">` in `<svelte:head>`, is no longer read as the component's code. It made the
  component unreadable, so the modules its real script imports were missing from `dependencies`.

- [#68](https://github.com/Huldoser/test-inventory/pull/68) [`fa9b97a`](https://github.com/Huldoser/test-inventory/commit/fa9b97affd5d8598dcb91f11c7fc2c5343ec5b87) - `dependencyHash` now follows what a Vue or Svelte single-file component imports, also the components and helpers only
  its template uses, so a change to a child component changes the hash of the tests that mount its parent. A component
  whose script doesn't parse is still taken by its text, and its tests get `hasUnfollowedDependencies`.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - A file with brackets nested more than 500 deep, such as a generated fixture, now gets a `parse-error` instead of
  crashing the scan. oxc-parser overflows the native stack on such a file, about 5,000 deep, and the process dies with a
  segmentation fault that no error handling can catch, so no inventory was written.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - `expectCount` now counts `expect.element()`, the assertion of Vitest browser mode, so a browser test that checks the
  page only with `await expect.element(locator).toBeVisible()` no longer looks like a test without assertions.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - An import written with a `.jsx` extension now finds the `.tsx` file it refers to, as `.js` already found `.ts`, so
  `import { OrderHeader } from './OrderHeader.jsx'` is followed instead of marking the test with
  `hasUnfollowedDependencies`.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - From Playwright 1.57, the config's `tag` is now read: every test gets it first in its `tags`, and a project's `grep` or
  `grepInvert` matches it, so a project with `grepInvert: /@nightly/` in a config with `tag: '@nightly'` no longer runs
  the tests. When the scan can't work out the `tag`, as for `process.env.CI_ENVIRONMENT_NAME`, it gets a
  `config-value-unknown` warning, and the tests of a project with a `grep` get `projects: null`.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - From Playwright 1.64, a project with `default: false` is no longer listed in a test's `projects`, as Playwright runs it
  only with `--project`, unless a project that runs lists it in `dependencies` or `teardown`. A `default` the scan can't
  work out gets a `config-value-unknown` warning, and the tests it may run get `projects: null`.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - Playwright's `defineConfig(base, config)` is now merged as Playwright merges it: a project of `config` merges into the
  project of `base` with the same name instead of replacing all of `base`'s projects, and `expect`, `use` and `build`
  merge key by key. A setup project from a base config is no longer lost, and an `expect.toHaveScreenshot.pathTemplate`
  from the base still marks the tests that compare screenshots with `hasUnfollowedDependencies`.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - A Vitest `retry` object in a test's or describe's options before Vitest 4.1 now gets an `unresolved-option` warning
  and `retries: null`. Vitest 4.0 and 3.2 never run such a test; the scan used to ignore the object and give the
  config's retry count instead.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - A Vitest test's own `skip`, `only`, `todo` or `fails` option now replaces the one its tags set, as Vitest does, so
  `test('title', { tags: ['flaky'], skip: false }, fn)` is active instead of skipped, and a conditional `skip` replaces
  the tag's unconditional one.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - An import that starts with `@/` or `~/`, as a Vite `resolve.alias` allows, now gives the test
  `hasUnfollowedDependencies` and a `dependency-not-followed` warning when no tsconfig `paths` define it. It was taken for
  an installed package, so the aliased file was missing from `dependencies` without a sign, and `--related` left the test
  out when that file changed.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - Vitest 5 tests follow the option rules of Vitest 5.0.5: the last of `.skip`, `skipIf()` and `runIf()` on a test
  decides its skip, so `test.skip.skipIf(false)` is active, and a `skipIf()` or `runIf()` replaces the skip of a tag or of
  the options a describe passes down. An option set to `undefined`, as in `test.skip('title', { skip: undefined }, fn)`,
  no longer undoes the chain or a tag.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - In Vitest 5, the projects of a config that another config lists in `projects` are named inside that config's name, as
  Vitest names them: the `unit` project of `apps/web/vitest.config.ts`, named `web`, is `web (unit)`.

- [#69](https://github.com/Huldoser/test-inventory/pull/69) [`41ce74d`](https://github.com/Huldoser/test-inventory/commit/41ce74d6dc5fb413ffcfa789442754a445f5572c) - A Vitest project without a `test.name` now has the name Vitest gives it, in `projects` and in `configs`: the `name` in
  the package.json of its folder, else the folder's name, so `projects: ['packages/*']` names its projects
  `@trading/pricing` or `ledger` instead of `""`. An inline project without a name is named after its place among the
  inline projects, as `0`, and in Vitest 5 no longer takes the name of the config it extends.

## 0.6.0

### Minor Changes

- [#61](https://github.com/Huldoser/test-inventory/pull/61) [`926352f`](https://github.com/Huldoser/test-inventory/commit/926352fd67caf8d26e17e346b9e916400e28a4e3) - Each test now has a `dependencyHash` of everything it runs in the project, beside the unchanged `bodyHash`: its own call
  with its options, the hooks, `test.use()` and options of its file and of every describe around it, the fixtures it,
  those hooks, conditions and `test.use()` values ask for, with the fixtures those ask for, `auto` ones and overrides of
  Playwright's own, through every `extend()` and `mergeTests()`, the file's other top-level code, the config and the
  configs it builds on, setup files, global setup and teardown, the Playwright setup projects the test runs after, and the
  snapshot files and screenshots it compares against, and the functions, classes, constants and modules all of these use,
  followed by scope and through imports, re-exports, barrels, `require()`, `import()` and Vitest's `vi.mock()` with a
  fixed path, with the code each module runs when it loads. A helper that declares the test is in it with the arguments of
  the call that declares it, so two calls give two hashes. Formatting and comments don't change it, nor does moving the
  test. Installed packages are left out, and types too, except for type tests.

  `dependencies` lists the files that went into the hash. When the test reaches something the scan can't follow, a local
  file that is missing or doesn't parse, an import with a path worked out at run time or a pattern, a value only a
  declaration file describes, or a setup file the config names in a way the scan can't work out,
  `hasUnfollowedDependencies` is `true` and the new `dependency-not-followed` warning says where, once per place.

- [#65](https://github.com/Huldoser/test-inventory/pull/65) [`31a9bee`](https://github.com/Huldoser/test-inventory/commit/31a9beef6f2912a03c4ae70ccd797b9b40cfe3e8) - `--related <file>` and the `related` filter of `filterInventory()` keep the tests a change to a file can affect: those
  whose `dependencies` include it, and those that reach code the scan can't follow, which a change may affect unseen.
  `--related -` reads the files from standard input, one per line, so `git diff --name-only origin/main... | npx
test-inventory --framework playwright --related -` lists the tests a pull request can affect. Paths are taken from the
  current folder, as git writes them, also when `--root` is a folder in the repository.

## 0.5.0

### Minor Changes

- [#51](https://github.com/Huldoser/test-inventory/pull/51) [`acec7e7`](https://github.com/Huldoser/test-inventory/commit/acec7e7fd9bae8301ba3559c3986264ea35c3056) - Each file record has a new `config` key: the config the file uses, as the runner started at the root would pick it.
  That is the outermost config at or above the file that runs it, and for Vitest `projects` the project that does,
  read from Playwright's `testDir`, `testMatch`, `testIgnore` and `.gitignore` files, and from Vitest's `include`,
  `exclude`, `includeSource`, `typecheck.include` and `benchmark.include` with each version's defaults. Before, the
  nearest config was taken, which is wrong for a root config whose `include` covers packages that have their own
  `vite.config.ts`. A file with tests that no config runs gets the new `file-not-run` warning.

  The globals check follows the same choice, so a test in a folder project without a config of its own gets Vitest's
  defaults, and a test the root config runs takes the root's `test.globals`. Files named by `benchmark.include` are
  marked `isBenchmark`, in place of the default `*.bench.*` and `*.benchmark.*` names. The config reader now reads
  regular expressions and paths built from `__dirname`, `__filename` or `import.meta` with `path.join()`,
  `path.resolve()`, `path.dirname()`, `fileURLToPath()` and `new URL()`.

- [#50](https://github.com/Huldoser/test-inventory/pull/50) [`3e55445`](https://github.com/Huldoser/test-inventory/commit/3e55445d0b195941813368b7beeea239ccf8792f) - The output lists the configs the scanned files use in a new top-level `configs` key, and as `config` lines in JSON
  Lines. A file uses the nearest `playwright.config.*`, `vitest.config.*` or `vite.config.*` in its folder or a folder
  above, up to the root, as the runner started in that folder would. A config is read as code, never run, and `extends`
  lists the files it takes settings from through imports, such as a shared base config.

  Vitest's globals now come from `test.globals` in the config a file uses, read through `defineConfig()`,
  `mergeConfig()`, spreads, constants and imported base configs. Before, any `globals: true` in a Vitest or Vite config
  in the file's folder or a folder above counted, also one Vitest doesn't read for the file, as in a `vite.config.ts`
  next to a `vitest.config.ts`. So `globals-not-enabled` can now appear where it didn't, and go away where a base config
  turns globals on. A `test.globals` the scan can't work out without running the config, and a config it can't read,
  get the new `config-value-unknown` warning.

- [#55](https://github.com/Huldoser/test-inventory/pull/55) [`a714612`](https://github.com/Huldoser/test-inventory/commit/a714612dcaf01eaa40d218bae44e7d27e68dbce6) - Run settings now come also from the config a file uses: Playwright's `timeout`, `retries` and `repeatEach`, and
  Vitest's `testTimeout`, `retry` and `repeats`, where the file sets none. New `timeoutSource`, `retriesSource` and `repeatsSource`
  keys say where each value comes from: `test`, `suite`, `file` or `config`, or `null` when nothing sets it. A test
  takes the settings of the projects that run it, after their `grep`. When those projects disagree, the config sets the
  value under a condition, as in `process.env.CI ? 2 : 0`, or the scan can't work out the projects, the value is `null`
  with its source `config`. For a value under a condition, `timeoutConfigText`, `retriesConfigText` and
  `repeatsConfigText` hold the config's text for it, so `retries: process.env.CI ? 2 : 0` reads as written. Playwright's `fullyParallel` and Vitest's `sequence.concurrent` make tests
  `isParallel` where the file sets no mode, when every project that runs the test sets it.

  A `.only` in a Playwright file whose config sets `forbidOnly` gets the new `forbidden-only` error, since the run then
  fails before any test runs. When `forbidOnly` depends on a condition, as in `!!process.env.CI`, it is a warning that
  quotes the condition.

- [#59](https://github.com/Huldoser/test-inventory/pull/59) [`aeb3eb1`](https://github.com/Huldoser/test-inventory/commit/aeb3eb10896ba79b82fb34e5b3dd08cb601a251d) - Vitest tags the config defines in `test.tags` now apply to the tests that carry them, as Vitest applies them. Their
  `skip`, `todo`, `fails` and `only` are merged with the test's own and those a describe passes down, and Vitest's order,
  `only` over `skip` over `todo`, gives the state, with the new `stateSource` value `config` when a tag sets it. Their
  `concurrent`, `timeout`, `retry`, `repeats` and `meta` set those keys where the test sets none: from Vitest 5 over a
  describe's options, and in Vitest 4.1 under them. The lowest `priority` wins between tags, and a Vitest 5 project's
  own `tags` replace those of the config it extends.

  A tag the config doesn't define fails the file in Vitest unless `strictTags` is off, also when there is no config, so
  it now gets the new `undefined-tag` error, and the file's tests are `notLoaded`; in a function or under a condition it
  is a warning, as that code may not run. The `config-may-change-state` warning now shows only when
  the scan can't work out the config's tags.

- [#54](https://github.com/Huldoser/test-inventory/pull/54) [`c610789`](https://github.com/Huldoser/test-inventory/commit/c61078957ce5150fde089a45a444cf5bef41cfe5) - Each test record has a new `projects` key: the names of the projects that run the test, of the config its file uses.
  For Playwright, those whose `testDir`, `testMatch` and `testIgnore` include the file, less those whose `grep` or
  `grepInvert` leaves the test's title and tags out; for Vitest, those whose files include it, with each browser
  instance as a project, named as Vitest names it, such as `unit (chromium)`. It is `[]` when no project runs the test,
  and `null` without a config or when the scan can't tell. Config records list their projects in `projects`, each with
  its `name`, `testDir` and Playwright's `dependencies`.

- [#53](https://github.com/Huldoser/test-inventory/pull/53) [`b9471ec`](https://github.com/Huldoser/test-inventory/commit/b9471ecd36f9f6157c21b013c7fa6cc9584250cd) - Glob patterns are optional, in `scan()` and on the command line: without them, the test files are those the
  Playwright or Vitest configs in the root and the folders below it run, each with the config it uses. A config whose
  files the scan can't work out gets a `config-value-unknown` warning that says to give patterns, and a scan without
  patterns and without a config says so in `no-files-matched`. An empty list of patterns is still an error.

### Patch Changes

- [#58](https://github.com/Huldoser/test-inventory/pull/58) [`1a34d74`](https://github.com/Huldoser/test-inventory/commit/1a34d74e76faead734afe87c0babc2a23fdbe4b7) - oxc-parser is updated from 0.154.0 to 0.156.0. The scan output doesn't change.

## 0.4.1

### Patch Changes

- [#48](https://github.com/Huldoser/test-inventory/pull/48) [`6549682`](https://github.com/Huldoser/test-inventory/commit/65496820548c0980cef2f290f6d54bd89160236b) - A hook given a function the file declares, as in `test.beforeEach(skipOnCI)` or `beforeEach(requireBroker)`, is read
  like one written in place: the skips, timeouts and other settings it sets apply to the tests it runs before, and its
  fixtures are in their `fixtures`. Before, they were missed. A test or hook function passed by name no longer gets a
  `state-in-helper` warning saying no test, hook or describe in the file calls it.

- [#47](https://github.com/Huldoser/test-inventory/pull/47) [`a603623`](https://github.com/Huldoser/test-inventory/commit/a603623b2431e51c3e48ae0413964d5a7125de59) - A `#` import or workspace package export whose target repeats the `*` of its pattern, as in
  `"#desks/*": "./desks/*/*-fixtures.ts"`, is followed to the file Node.js loads, with every `*` filled in. Only the
  first was filled in before, so the import wasn't followed and its tests were missing, with an `unresolved-test-import`
  error. A folder given as the pattern with a long run of slashes, as in `tests////unit`, no longer slows the scan down
  while the hint for it is written.

## 0.4.0

### Minor Changes

- [#42](https://github.com/Huldoser/test-inventory/pull/42) [`6849f55`](https://github.com/Huldoser/test-inventory/commit/6849f555d8b214ebbc8fdb9aa9cbac8cfe0913db) - Tests say what their body does: `fixtures` (the names the test and the `beforeEach`, `afterEach` and `aroundEach` hooks around it take from the context, without Vitest's own keys), `expectCount` (`expect()`, `expect.soft()` and `expect.poll()` calls in the body), Vitest's `expect.assertions(n)` and `expect.hasAssertions()` as `expectedAssertions` and `expectsAssertions`, `hasEmptyBody`, and Playwright's `test.step()` titles in `steps`. Vitest's `annotate()` from the test context adds annotations. Vitest 5 benchmarks, in `*.bench.ts` files or using the `bench` fixture, have `isBenchmark` and a `benchmarkCount` in the summary. New warnings: `empty-title` for a test or describe titled `''`, and `bench-outside-benchmark-file`.

- [#40](https://github.com/Huldoser/test-inventory/pull/40) [`f462ee0`](https://github.com/Huldoser/test-inventory/commit/f462ee015fea8ee802f567a26dbaa4db94ada1d5) - The output has a record for each scanned file in `files`, and counts hooks: `hooks` on a file holds the hooks at its top level, on a describe the hooks registered in it, and on a test every hook that runs around it, by kind (`beforeAll`, `beforeEach`, `afterEach`, `afterAll`, and Vitest's `aroundEach` and `aroundAll`). Hooks a helper function registers count where it is called. JSON Lines output has a `file` line for each file, and a filtered inventory keeps the files of the matched tests and the files without tests.

- [#41](https://github.com/Huldoser/test-inventory/pull/41) [`1ab9cb4`](https://github.com/Huldoser/test-inventory/commit/1ab9cb4002dd971ddb62570dc55ac564504e3a83) - Tests and describes have their run settings: `timeout`, `isSlow` and `slowCondition`, `retries`, `retryDelay`, `retryCondition` and `repeats`. Playwright's come from `test.describe.configure({ timeout, retries })`, `test.setTimeout()` and `test.slow()` in a describe, a `beforeEach` or the test body; Vitest's from the `timeout`, `retry` and `repeats` options, the timeout after the body, and the options a describe passes down. A test gets the value from the nearest place that sets it, and `null` when the file sets none, so the config decides. A timeout that can't be worked out, or that is set only under a condition, gets an `unresolved-option` warning.

## 0.3.0

### Minor Changes

- [#37](https://github.com/Huldoser/test-inventory/pull/37) [`5aeb139`](https://github.com/Huldoser/test-inventory/commit/5aeb13959daaeb0fdf4488765944fe42ef7754bc) - `--fields` keeps only the named keys of each test, and `id`, as in `--fields fullName,reason`, so a short question gets a short answer. Output written with it leaves keys out, so it no longer matches the JSON Schema. The library exports the same as `pickTestFields()`.

- [#37](https://github.com/Huldoser/test-inventory/pull/37) [`5aeb139`](https://github.com/Huldoser/test-inventory/commit/5aeb13959daaeb0fdf4488765944fe42ef7754bc) - Filters keep only the tests a question is about: `--state`, `--tag`, `--grep` (a regular expression on the full name, ignoring case), `--only` and `--without-reason`, as in `--state skip --state fixme` for the tests that don't run. The output then describes only those tests: the describes around them, their diagnostics and a summary counted over them. The library exports the same as `filterInventory()`.

- [#37](https://github.com/Huldoser/test-inventory/pull/37) [`5aeb139`](https://github.com/Huldoser/test-inventory/commit/5aeb13959daaeb0fdf4488765944fe42ef7754bc) - `--format jsonl` writes the inventory as JSON Lines: an `inventory` line, one line per suite, test and diagnostic, and a `summary` line, each marked with a `type` key. Tools that read one record per line, such as `grep` or DuckDB, no longer need the whole document in memory. The `InventoryLine` type describes the lines.

### Patch Changes

- [#34](https://github.com/Huldoser/test-inventory/pull/34) [`0f96258`](https://github.com/Huldoser/test-inventory/commit/0f96258e65085fa1b7c667b5fa7219a8b19230df) - A fixtures file that builds its test object with a function, written there or imported from another file, as in `export const test = defineDeskTest('equities')`, is followed: MSW's test files import such a `test`. Their tests were missing before, with no diagnostic when the fixtures file didn't import the framework itself. A test object built with a call the scan can't follow now gets an `unresolved-test-import` error that names the call, as in "builds it with withWarmup(), which is not followed". A function that returns what another function returns, as `() => onFeed('NYSE')`, is followed too.

- [#34](https://github.com/Huldoser/test-inventory/pull/34) [`0f96258`](https://github.com/Huldoser/test-inventory/commit/0f96258e65085fa1b7c667b5fa7219a8b19230df) - A call the runner refuses that is written like a declaration, as `describe.sequential('title', fn)` in Vitest 5, `test('title', fn, { retry: 2 })` from Vitest 4 or `test.only.skip('title', fn)`, is listed as a plain test or describe without the part that fails. Its tests were missing before; now they are `notLoaded`, like every other test in the file.

- [#34](https://github.com/Huldoser/test-inventory/pull/34) [`0f96258`](https://github.com/Huldoser/test-inventory/commit/0f96258e65085fa1b7c667b5fa7219a8b19230df) - States follow the runners' precedence more closely, as checked against Vitest 5.0.4 running generated files. A skip in a test or hook body loses to a fixme, skip or todo set while the file loads, as on a describe around the test, since the body never runs. In Vitest, a test's own options win over its chain, so `test.skip('title', { skip: false }, fn)` is active, but the chain still sets its mode: `test.concurrent('title', { concurrent: false }, fn)` runs in parallel. A describe passes its `skip` option down to the tests and describes inside, where it wins over todo, also when the describe's own `.only` keeps the describe itself from being skipped.

## 0.2.1

### Patch Changes

- [#28](https://github.com/Huldoser/test-inventory/pull/28) [`04ff6d2`](https://github.com/Huldoser/test-inventory/commit/04ff6d2dd5a7ecc8fabffbf16b259fc9f2a68110) - A skip in a `catch` block, such as `context.skip()` when a test server can't start, is conditional, with the `catch` clause as its condition, as in `catch (error)`. It was recorded as an unconditional skip before. A test declared in a `catch` block gets `isInCondition: true`.

- [#32](https://github.com/Huldoser/test-inventory/pull/32) [`3fcc933`](https://github.com/Huldoser/test-inventory/commit/3fcc93368dc9a4d810ff52b8d7d5fe4f99ca63ee) - Globs match folders and files whose names start with a dot, as in `.storybook/` or `.github/scripts/`, as they do in Playwright and Vitest; test files there were left out before. `.git` folders are always left out, like `node_modules`.

- [#31](https://github.com/Huldoser/test-inventory/pull/31) [`631cc6b`](https://github.com/Huldoser/test-inventory/commit/631cc6b208aca5b28076da6eba33d8e6426ab778) - Workspace packages are found from both `pnpm-workspace.yaml` and the `workspaces` of `package.json`. When a repository had both, as after a move to pnpm that kept the old list, only `package.json` was read, and a package listed only in `pnpm-workspace.yaml` got an `unresolved-test-import` error.

- [#30](https://github.com/Huldoser/test-inventory/pull/30) [`968e2bc`](https://github.com/Huldoser/test-inventory/commit/968e2bcd15c2157faae8fe91604634b1c1f68175) - A call through an imported name that reads like a test function is followed, and reported with `unresolved-test-import` when it can't be, also when it goes through a member the scan doesn't know, as in `it.effect('title', fn)` from `@effect/vitest`, or passes a timeout after the body, as in `test('title', fn, 60_000)`. Such tests were missing before, with no diagnostic. A module's own export of a name now wins over the same name passed on by `export *`, as in JavaScript: `export const it = ...` next to `export * from 'vitest'` is no longer read as Vitest's `it`.

- [#28](https://github.com/Huldoser/test-inventory/pull/28) [`04ff6d2`](https://github.com/Huldoser/test-inventory/commit/04ff6d2dd5a7ecc8fabffbf16b259fc9f2a68110) - Tests on a test object that a function returns are found, as in `conditionalTest({ min: 22 })('title', fn)` or `const quoteTest = onNode(22)`, when the function is declared in the file or imported from a local file. They were missing before, with no diagnostic. When the function returns a different test function on different runs, as `it.skip` or `it`, only the modifiers they all have apply, as for a variable chosen by a condition. When the function can't be followed and its name reads like a test object, as for one from an installed package, the calls on what it returns are read as tests on trust, with a `local-test-object` warning.

## 0.2.0

### Minor Changes

- [#18](https://github.com/Huldoser/test-inventory/pull/18) [`4698945`](https://github.com/Huldoser/test-inventory/commit/46989455dda81842d0a947bafb8d1270654be250) - A custom `test` object is followed through as many files as it takes: a fixtures file may re-export it, as in `export * from './base'`, or build it with `extend` on one imported from another file. When it can't be followed, the `unresolved-test-import` message says where the chain of files ends. A test file that builds its own test object from an imported one, as in `const test = base.extend({...})`, no longer gets a `local-test-object` warning when the import is followed.

- [#18](https://github.com/Huldoser/test-inventory/pull/18) [`4698945`](https://github.com/Huldoser/test-inventory/commit/46989455dda81842d0a947bafb8d1270654be250) - Tests and describes declared in a helper function are recorded at each call of the helper from the file or a describe, in the describe around the call, as the runner registers them; before, they were listed once, where written. Titles built from the helper's parameters are worked out from each call's arguments. Helpers imported from other files are followed too: their records give the call in the scanned file as their location, and a new `declaredAt` key on test and suite records gives the file and line where the helper writes the test, `null` for code in the scanned file. Records of tests in helpers get new ids, as their describes change. The `test-in-function` warning now only marks tests in functions the scan can't place, and the call where the scan stops following helpers, after 10,000 calls in a file.

- [#18](https://github.com/Huldoser/test-inventory/pull/18) [`4698945`](https://github.com/Huldoser/test-inventory/commit/46989455dda81842d0a947bafb8d1270654be250) - Files that playwright-bdd generates from Gherkin features are read: they import Playwright's `test` from `playwright-bdd`.

- [#18](https://github.com/Huldoser/test-inventory/pull/18) [`4698945`](https://github.com/Huldoser/test-inventory/commit/46989455dda81842d0a947bafb8d1270654be250) - In Playwright, a test in a loop whose title path is the same on each pass gets a `duplicate-title` error, and the tests in its file are `notLoaded`, as Playwright refuses the file. Vitest runs duplicate titles, so nothing changes there.

- [#18](https://github.com/Huldoser/test-inventory/pull/18) [`4698945`](https://github.com/Huldoser/test-inventory/commit/46989455dda81842d0a947bafb8d1270654be250) - Path aliases come from the tsconfig nearest the importing file, as TypeScript finds it, with every file it `extends`, packages included, and `${configDir}` filled in. Without a `tsconfig.json`, the nearest `tsconfig.base.json` is used, as in an Nx workspace, and a solution-style tsconfig takes its aliases from the projects it `references`.

- [#18](https://github.com/Huldoser/test-inventory/pull/18) [`4698945`](https://github.com/Huldoser/test-inventory/commit/46989455dda81842d0a947bafb8d1270654be250) - Workspace packages are followed before an install, from the `workspaces` of `package.json` or from `pnpm-workspace.yaml`. When a package's `exports`, `types` or `main` point to build output that doesn't exist yet, as in `dist/esm/index.js`, the source next to it in `src/` is used. Patterns and links that lead out of the workspace folder are not followed.

### Patch Changes

- [#19](https://github.com/Huldoser/test-inventory/pull/19) [`bc7a0c3`](https://github.com/Huldoser/test-inventory/commit/bc7a0c36b364b338e1aef0c0a7622b22590a8305) - A test or hook that calls helper functions which call each other in many places no longer makes the scan hang. Each helper's states are applied once for each set of conditions it is reached under, and past 10,000 helper calls from one call, a `state-in-helper` warning says the rest are not applied.

- [#20](https://github.com/Huldoser/test-inventory/pull/20) [`7f32dd4`](https://github.com/Huldoser/test-inventory/commit/7f32dd4605e93fa0db47200b917dfafb91ac1da5) - oxc-parser is updated from 0.153.0 to 0.154.0. The scan output doesn't change.

## 0.1.2

### Patch Changes

- [#13](https://github.com/Huldoser/test-inventory/pull/13) [`89a029f`](https://github.com/Huldoser/test-inventory/commit/89a029f9e45c2aaa57b5f907717bb8f00829e335) - Locks set with `test.describe.configure({ lock })`, new in Playwright 1.64, are added to every test in the file or describe where the call is made. They were dropped before.

- [#13](https://github.com/Huldoser/test-inventory/pull/13) [`89a029f`](https://github.com/Huldoser/test-inventory/commit/89a029f9e45c2aaa57b5f907717bb8f00829e335) - From Vitest 5, a file that calls `vi.mock`, `vi.unmock` or `vi.hoisted` anywhere but its top level gets a `removed-api` error at the call, and its tests are `notLoaded`, as Vitest refuses the file. Files with in-source tests are not checked, as in Vitest.

## 0.1.1

### Patch Changes

- [#5](https://github.com/Huldoser/test-inventory/pull/5) [`c812450`](https://github.com/Huldoser/test-inventory/commit/c812450a0652339ccc713ce305a14882154dd6e6) - A custom test object imported from `'.'` or `'..'` is followed like other relative imports.

- [#5](https://github.com/Huldoser/test-inventory/pull/5) [`c812450`](https://github.com/Huldoser/test-inventory/commit/c812450a0652339ccc713ce305a14882154dd6e6) - When a pattern names a folder, the `no-files-matched` message suggests a pattern for the test files in it, and the command line prints that message.

- [#5](https://github.com/Huldoser/test-inventory/pull/5) [`c812450`](https://github.com/Huldoser/test-inventory/commit/c812450a0652339ccc713ce305a14882154dd6e6) - A pattern whose folder doesn't exist now gives only the `no-files-matched` warning, not a `read-error`.

- [#5](https://github.com/Huldoser/test-inventory/pull/5) [`c812450`](https://github.com/Huldoser/test-inventory/commit/c812450a0652339ccc713ce305a14882154dd6e6) - Messages for problems that make Playwright refuse a file now say that Playwright runs no tests at all, in any file.

- [#5](https://github.com/Huldoser/test-inventory/pull/5) [`c812450`](https://github.com/Huldoser/test-inventory/commit/c812450a0652339ccc713ce305a14882154dd6e6) - A new `test-in-function` warning marks a test declared in a function that is called more than once, from another describe, never, or from other files. The runner registers such a test in the describe around each call, while the record stays where the test is written.

- [#5](https://github.com/Huldoser/test-inventory/pull/5) [`c812450`](https://github.com/Huldoser/test-inventory/commit/c812450a0652339ccc713ce305a14882154dd6e6) - A version range that starts below the oldest supported version, such as `^1.40.0`, now gets the `approximate-framework-version` warning, since the newest rules of its major apply.

- [#5](https://github.com/Huldoser/test-inventory/pull/5) [`c812450`](https://github.com/Huldoser/test-inventory/commit/c812450a0652339ccc713ce305a14882154dd6e6) - Every test in a Vitest file that fails to load is now `notLoaded`, as Vitest runs none of them: a chain Vitest doesn't have, `sequential` or `bench` from Vitest 5, or options as the third argument from Vitest 4. A call to `bench` is reported where it is made, not where it is imported.

## 0.1.0

### Minor Changes

- [#1](https://github.com/Huldoser/test-inventory/pull/1) [`5073b07`](https://github.com/Huldoser/test-inventory/commit/5073b078db34185f1069d71a869a6c8671621977) - First release. Scans Playwright and Vitest test files and lists every test declaration as JSON, with its location, describes, tags, annotations and state, without running the tests.
