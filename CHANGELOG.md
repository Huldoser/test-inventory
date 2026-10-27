# test-inventory

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
