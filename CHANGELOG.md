# test-inventory

## 0.10.1

### Patch Changes

- [#99](https://github.com/Huldoser/test-inventory/pull/99) [`df8968d`](https://github.com/Huldoser/test-inventory/commit/df8968dc0357353913b96fadd417a266ab290b2c) - Keep Playwright declaring modifiers when functions are stored in variables or selected inline. Read logical choices with the same rules as the other runners, and classify each nested branch once to avoid exponential traversal.

  Match Vite's alias merge precedence and preserve object aliases when mixed with lists. Mark imports as unfollowed when an unreadable alias entry or find could match them.

  Ignore annotation and step line numbers in inventory diffs, so moving unchanged tests to another line does not report metadata changes.

- [#100](https://github.com/Huldoser/test-inventory/pull/100) [`fa10d39`](https://github.com/Huldoser/test-inventory/commit/fa10d3970046e4e99b6f175ff5dcf0eee13ccfcd) - Read locally declared describe callbacks passed by name, preserving suite placement, inherited state, lexical values and expanded table arguments. Keep suite hashes, dependencies and nested parent links complete, including when a child is written before its calling parent. Apply the existing helper traversal limits and runner callback checks to these callbacks.

## 0.10.0

### Minor Changes

- [#96](https://github.com/Huldoser/test-inventory/pull/96) [`86e1765`](https://github.com/Huldoser/test-inventory/commit/86e1765d7b8fb763f34d0f024fb53931192b4e1b) - Compare two complete saved scans with `test-inventory diff old.json new.json` or `diffInventories(before, after)`.
  Reports additions, removals, renamed and moved tests, changed code and dependencies, state, tags and other metadata.
  Matches ids first, then body hashes with file, suite or dependency context, leaving ambiguous matches unmatched.
  Includes exact body clone groups, JSON Schema, and escaped Markdown output through `--format markdown` or
  `formatDiffMarkdown`. Hash comparisons and rename matching require identical tool versions; incomplete scans warn.

### Patch Changes

- [#96](https://github.com/Huldoser/test-inventory/pull/96) [`86e1765`](https://github.com/Huldoser/test-inventory/commit/86e1765d7b8fb763f34d0f024fb53931192b4e1b) - Keep unreadable config aliases as dependency gaps rather than silently treating their imports as installed packages.
  Read string concatenation and templates in config paths. Follow config aliases in setup paths, Jasmine helper globs,
  Cypress's default and configured support files, Bun preload files, and Node script preloads in dependencies and
  dependencyHash, so --related keeps tests affected by changes to those files.

- [#96](https://github.com/Huldoser/test-inventory/pull/96) [`86e1765`](https://github.com/Huldoser/test-inventory/commit/86e1765d7b8fb763f34d0f024fb53931192b4e1b) - Apply Mocha's focus filtering, including Cypress and WebdriverIO on Mocha, so an outer describe.only does not focus
  tests that a more specific focus excludes. A root focused test in standalone Mocha excludes child suites across
  files. Contain refused calls inside node:test and Bun describe callbacks: Node keeps earlier tests and tests outside
  the describe; Bun loses that describe only. Vitest reads allowOnly per project, does not fail unconditionally skipped
  focused tests, and refuses modifiers after a called each or for table.

## 0.9.1

### Patch Changes

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - Bun: a test whose function is passed by name, followed by a timeout or options, as in
  `test('reprices a basket', repricesBasket, 5_000)`, is read as a test. The scan took the timeout for the function and
  reported a `test-without-body` error, listing every test in the file as not loaded, though Bun runs them.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - A `__proto__` key in a `bunfig.toml` or `.mocharc.yml` is read as a plain key, as Bun and Mocha read it. A
  `bunfig.toml` with a `[__proto__]` table changed `Object.prototype` for the whole process, so every later scan in it,
  such as those of a long-running MCP server, read settings the project never set. A `.mocharc.yml` one gave its map the
  settings inside it. TOML keys named `constructor` or `toString` are read too, where they were refused.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - Cypress: `specPattern` and `excludeSpecPattern` are read as globby, which Cypress uses, reads them. A `specPattern` that
  starts with `!` leaves files out, where the scan took it to match every other file and listed nearly the whole project;
  an `excludeSpecPattern` drops its `!`, where the scan left out everything else; and a folder in either stands for every
  file below it, where it matched nothing.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - Jasmine: a describe callback with a TypeScript `this` parameter, a parameter with a default value or a rest parameter,
  as `function (this: object)`, is no longer reported as taking arguments. Jasmine checks the function's `length`, which
  counts none of these, and runs the specs; the scan listed them as not loaded.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - Jasmine: an `xdescribe` inside an `fdescribe` stays skipped, as in Jasmine, where the scan listed its specs as active;
  a focus inside the `xdescribe` still runs. WebdriverIO on Jasmine now follows Jasmine's focus rules: a `fit` inside an
  `xdescribe` runs, and in an `fdescribe` with a `fit` below it only the `fit` has `isOnly`, where the scan applied
  Mocha's rules.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - A `<rootDir>` entry in Jest's `moduleDirectories`, as `['node_modules', '<rootDir>/src']`, is followed as a folder to
  look in, as Jest does. The scan looked for a folder named `<rootDir>/src` and left the files out of `dependencies`
  without a warning.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - Jest's `moduleNameMapper` replaces the whole import name, as Jest does, also when its pattern matches only part of it,
  as `'\\.css$'` does. The scan replaced only the matched part, so a mapped style or file mock was missing from
  `dependencies` and its import got a `dependency-not-followed` warning. Vite's aliases still replace only the part they
  match.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - Test files reached through a symbolic link are read the way each runner reads them. Jasmine and Bun follow such links
  and run the file once, as Vitest and Mocha do, so the file is no longer left out; Bun names it by its own path, as its
  reports do. node:test runs a linked file, twice when its own path matches too, but a wildcard in its pattern doesn't
  enter a linked folder. The `symlink-ignored` warning now names the runner in use, where it named Playwright for every
  runner but Jest.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - Mocha: an absolute glob in `spec`, as a `.mocharc.js` builds it with `path.join(__dirname, 'test', '**', '*.spec.js')`,
  runs the files it matches. The scan matched it against paths relative to the config's folder, found nothing, and
  reported `no-files-matched`.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - Mocha, Cypress and WebdriverIO on Mocha: `this.skip()` in an `afterEach` hook no longer marks the tests as skipped.
  The test has passed by the time the hook runs, and Mocha reports it as a pass.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - Mocha: a `.only` in a project whose config sets `forbid-only` (or `forbidOnly`) gets a `forbidden-only` error, as Mocha
  stops the run before any test runs, or a warning when the setting depends on a condition, as Playwright's `forbidOnly`
  does.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - A `.mocharc.yml` is read as js-yaml, Mocha's reader, reads it. Files that Mocha reads and the scan refused, which lost
  every setting and so the files to test, are now read: a byte order mark, a comment or a `%YAML` line before `---`, a
  `...` at the end, quoted list items with commas, as `['test/**/*.{ts,js}']`, YAML's escapes in double quotes, as
  `\x41`, and a tab or an escaped quote followed by ` #` in quotes. A quote inside a value, as in `grep: buy 'limit # note`,
  no longer hides the comment after it, `-a.js` on its own line is a value, not a list item, and what Mocha refuses is
  reported rather than read: a key set twice, a tab in the indent, `a: b` in a value, a list inside a list, and values
  that start with `@`, `` ` `` or `%`. `-.5` is a string, as js-yaml reads it. A long line is read in linear time; one of
  160 KB took 5 seconds.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - node:test and Bun: a skipped describe skips every test inside it, over the test's own todo, as node:test creates none of
  them, and in Bun the outermost skipped or todo describe decides, over the describes inside it and the test's own state.
  The scan took the state nearest the test, so `test.todo()` in `describe.skip()` was todo, and in Bun `test.skip()` in
  `describe.todo()` was skipped.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - node:test: a test whose function is passed by name, as `test('fills a market order', fillsMarketOrder)` or
  `test(fillsMarketOrder)`, gets that function's `bodyHash`, and without a title the function's name, as Node.js names it.
  The scan took the function for the test's options, with an `unresolved-option` warning and no hash, or for a title it
  couldn't work out.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - node:test: the scan reads the `node --test` commands of every script the `test` script runs through `npm run`, `pnpm`,
  `yarn`, `bun run`, `npm-run-all`, `run-s` or `run-p`, as in `"test": "npm run test:unit && npm run test:integration"`.
  It read only the first script that runs `node --test`, and left out the files of the others without a warning.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - From Playwright 1.65, `test.skip('reason')`, `test.fixme('reason')` and `test.fail('reason')` with only a string give
  that string as the record's `reason`, in a test body and at file or describe level, and no longer a `skip-without-body`
  warning, as Playwright 1.65 takes the string as the description. An empty string still applies nothing. Older versions
  keep the old reading.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - A `dependency-not-followed` warning for an import a config maps to a file that doesn't exist gives that file's path
  relative to the root, as every path in the output is. It gave the absolute path, as `path.resolve()` or `<rootDir>`
  built it, so the output differed from machine to machine.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - A test or describe function chosen in place, as in `(process.env.CI ? it.skip : it)('books a fill', ...)` or
  `(process.env.CI && it.skip || it)(...)`, is read as one kept in a variable: only what both choices share applies. The
  scan dropped these tests without a warning, for every runner but Playwright, whose case is still open. Jasmine
  variables that hold `xit`, `fit`, `xdescribe` or `fdescribe`, as `const later = xit`, keep the `x` or `f`, as the docs
  said; their tests were dropped too.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - A Vite alias to a path that starts with `/`, as `alias: { '@': '/src' }`, is followed from the project's root, as Vite
  does, so `dependencies` and `dependencyHash` include the files imported through it. The scan looked for `/src` on the
  disk, gave a `dependency-not-followed` warning and left the files out.

- [#92](https://github.com/Huldoser/test-inventory/pull/92) [`0001eea`](https://github.com/Huldoser/test-inventory/commit/0001eeac49b8b7ae0c675ae12c1aa8d29daf17ff) - WebdriverIO: a `specs` or `exclude` glob that starts with `!` matches no file, as in WebdriverIO, where the scan took it
  to match every other file; a glob that starts with `./` matches from the config's folder only, as its slash keeps glob's
  `matchBase` off; from WebdriverIO 10 a capability's `specs` and `exclude` are no longer read, only `wdio:specs` and
  `wdio:exclude`; and a capability's settings inside `alwaysMatch` are read.

## 0.9.0

### Minor Changes

- [#88](https://github.com/Huldoser/test-inventory/pull/88) [`2d370c9`](https://github.com/Huldoser/test-inventory/commit/2d370c9030c5fafae900d2442d75e70781a5b938) - Bun 1.2.23 and newer: `--framework bun`, also found from a package.json script that runs `bun test` or a
  `bunfig.toml`. Its version comes from `.bun-version`, `packageManager` or `engines.bun`, else `@types/bun` or
  `bun-types`. The scan reads Bun's globals and imports of `bun:test`, `@jest/globals` and `vitest`, which Bun rewrites;
  chains of `.skip`, `.todo`, `.failing`, `.only`, `.concurrent`, `.serial` and `.each` in any order, refusing the
  combinations Bun refuses; the conditions `.if`, `.skipIf`, `.todoIf`, `.failingIf`, `.concurrentIf` and `.serialIf`;
  options second or third, a number as the timeout or `{ timeout, retry, repeats }`; and `.each` titles as Bun formats
  them. The files are Bun's `*.test.*`, `*_test.*`, `*.spec.*` and `*_spec.*` under `bunfig.toml`'s `[test] root`, less
  `pathIgnorePatterns`, with its `retry` and `concurrentTestGlob` applied. A small TOML reader reads `bunfig.toml`.

  The oldest version a framework supports may now name a patch, as Bun's 1.2.23 does.

- [#87](https://github.com/Huldoser/test-inventory/pull/87) [`ae2bd90`](https://github.com/Huldoser/test-inventory/commit/ae2bd909d769ea5e21200fceb3d9f081de7661db) - `dependencyHash` follows imports through the config a file runs with: Vite's `resolve.alias` and Vitest's
  `test.alias`, as an object or a list of `{ find, replacement }` with a name or a regex, and Jest's `moduleNameMapper`,
  `modulePaths` and `moduleDirectories`, with `<rootDir>`. They were read from tsconfig `paths` only, so tests that
  imported through such aliases had `hasUnfollowedDependencies` and a hash that missed those files. A mapping to no file
  is a `dependency-not-followed` warning that names it.

- [#83](https://github.com/Huldoser/test-inventory/pull/83) [`9ef9c59`](https://github.com/Huldoser/test-inventory/commit/9ef9c5959b908191e8015c8c880a3c476f43fccd) - Cypress 13 and newer: `--framework cypress`, also found from a `cypress` package or a `cypress.config.*` file. Tests are
  read as Mocha's, with Cypress's test config before the function: `retries`, of which `cypress run` takes `runMode`,
  `browser` as a skip condition, `@cypress/grep`'s `tags`, and from Cypress 16 an error for `env`, which Cypress refuses
  there. `this.timeout()` is not read, as Cypress has only command timeouts; `this.retries()` in a describe and
  `.retries()` after `it()` or `describe()` are errors, as Cypress throws on them while it loads the spec. The config's
  testing types are the projects, `e2e` and `component`, each with its `specPattern`, `excludeSpecPattern` and `retries`.

  A project whose package.json lists `cypress` next to another runner, as Jest or Vitest for unit tests, now needs
  `--framework`, as the scan asks for one whenever it finds several runners.

- [#82](https://github.com/Huldoser/test-inventory/pull/82) [`04e7328`](https://github.com/Huldoser/test-inventory/commit/04e73289dd946bd4c92ec774510ebc369ee80699) - Jasmine 4 and newer: `--framework jasmine`, also found from a `jasmine` or `karma-jasmine` package or a
  `spec/support/jasmine.*` config. The scan reads `describe`, `it` and their `x` and `f` forms with Jasmine's focus, a
  spec without a function as pending, `pending(reason)` in a spec or its `beforeEach` or `afterEach`, from Jasmine 7
  `notApplicable(reason)`, the hooks, and a spec's timeout. The config's `spec_dir` and `spec_files`, with `!`
  exclusions, decide the files; without a config, as in Karma and Angular projects, the files given by glob run. A call
  Jasmine refuses stops the whole run at the top level of a file, and is an error that leaves the file's tests as they
  are inside a describe, which Jasmine catches.

- [#81](https://github.com/Huldoser/test-inventory/pull/81) [`85fb8a9`](https://github.com/Huldoser/test-inventory/commit/85fb8a90998f88641400ebb8a6db3b392e2b54d2) - Mocha 10 and newer: `--framework mocha`, also found from a `mocha` package, a `.mocharc.*` file or a `mocha` key in
  `package.json`. The scan reads `describe`, `context`, `it`, `specify`, their `x` forms, `.only` and `.skip`, a test
  without a function as pending, `ui: tdd`'s `suite` and `test`, the hooks, `this.timeout()`, `this.retries()` and
  `this.skip()` where `this` is Mocha's, and `.timeout()` and `.retries()` after `it()` and `describe()`. The config's
  `spec`, `extension`, `recursive`, `ignore` and `file` decide the files, and its `timeout` and `retries` apply to every
  test; a YAML config is read too. A describe without a function, `it()` or `describe()` without a title, and an
  unknown chain such as `it.concurrent` are errors, as Mocha then runs no test.

  A project whose package.json lists `mocha` next to another runner now needs `--framework`, as the scan asks for one
  whenever it finds several runners.

- [#86](https://github.com/Huldoser/test-inventory/pull/86) [`1085fb7`](https://github.com/Huldoser/test-inventory/commit/1085fb74b85eefe64c6bdd217b2c19c2946441d4) - node:test on Node.js 22 and newer: `--framework node`, also found from a package.json script that runs `node --test`
  or a `node.config.json`. Its version is the Node.js version the project pins in `.node-version`, `.nvmrc`, Volta's
  `node` or `engines.node`. The scan reads `test`, `it`, `describe` and `suite` from `node:test`, imported or required,
  with `.skip`, `.todo`, `.only` and from 24.14 `.expectFailure`, and the options `skip`, `todo`, `only`, `timeout`,
  `concurrency`, `expectFailure` and from 24.19 and 26.2 `tags`; `t.skip()` and `t.todo()` in a test's body; and the
  hooks. The files are those the script gives `node --test`, or Node.js's default patterns, with TypeScript files from
  22.18.

  A test declared in a test's body, with `t.test()` or `test()`, is a subtest that node:test runs while it runs the test:
  it is listed with the test's title in `suitePath` and the test's id in the new key `parentTestId`, which is `null` for
  every other test.

- [#80](https://github.com/Huldoser/test-inventory/pull/80) [`cae53c1`](https://github.com/Huldoser/test-inventory/commit/cae53c107fce5a3024f7666c83d9b2582bb9017b) - A new `invalid-fixture-argument` error: a rest property among a Playwright function's fixture arguments, as
  `async ({ page, ...fixtures }) => {}` in a test, hook, `test.skip()` condition or `test.extend()` fixture written in
  the test file. Playwright refuses it and runs no tests at all, so the file's tests are now `notLoaded` instead of
  `active`. A nested rest, as `({ page: { mouse, ...pointer } })`, and a `test.step()` callback are allowed, as
  Playwright allows them.

- [#85](https://github.com/Huldoser/test-inventory/pull/85) [`90df9aa`](https://github.com/Huldoser/test-inventory/commit/90df9aa07741fab403470e653595b1b644b35dc3) - `scan()` takes a `signal`, an `AbortSignal`: the scan checks it before it starts and between files, and rejects with
  the signal's `reason` once it aborts, so a server can stop a scan its client no longer waits for.

- [#85](https://github.com/Huldoser/test-inventory/pull/85) [`90df9aa`](https://github.com/Huldoser/test-inventory/commit/90df9aa07741fab403470e653595b1b644b35dc3) - A Vitest `.only` that `allowOnly` makes fail is a `forbidden-only` diagnostic, as for Playwright's `forbidOnly`: an
  error when the config sets `test.allowOnly` to `false`, and a warning when it is unset, as Vitest then turns it off in
  CI, or depends on a condition. Vitest marks such a test failed instead of running it.

- [#84](https://github.com/Huldoser/test-inventory/pull/84) [`c68bac7`](https://github.com/Huldoser/test-inventory/commit/c68bac7442f7d5197c8f67bfbec66a8c9ee3f4d5) - WebdriverIO 9 and newer: `--framework webdriverio`, also found from a `@wdio/cli` package or a `wdio.conf.*` file. The
  config's `config` export, ES or CommonJS, decides the files: `specs`, with the nested lists that group files into one
  worker, less `exclude`, matched as WebdriverIO matches them. Its `framework` decides how the tests are read, Mocha by
  default or Jasmine, with `mochaOpts.timeout`, `retries` and `ui`, or `jasmineOpts.defaultTimeoutInterval`, on every
  test; Cucumber is reported, as its feature files aren't read. A number after a test's function is WebdriverIO's retry
  count, and with Jasmine a second one, after the timeout. Mocha's and Jasmine's version gates follow the versions
  WebdriverIO depends on. With Mocha, a call the runner refuses stops the file loading there, and the tests declared
  above it still run. The config's `rootDir` and each capability's own `specs` and `exclude` are read too.

  A project whose package.json lists `@wdio/cli` next to another runner now needs `--framework`, as the scan asks for
  one whenever it finds several runners.

### Patch Changes

- [#85](https://github.com/Huldoser/test-inventory/pull/85) [`90df9aa`](https://github.com/Huldoser/test-inventory/commit/90df9aa07741fab403470e653595b1b644b35dc3) - `expectCount` counts Playwright's `expect.configure(...)`, called in place as `expect.configure({ timeout: 5_000 })(locator)`
  or kept in a variable as `const slowExpect = expect.configure(...)`; it missed both.

- [#83](https://github.com/Huldoser/test-inventory/pull/83) [`9ef9c59`](https://github.com/Huldoser/test-inventory/commit/9ef9c5959b908191e8015c8c880a3c476f43fccd) - The error for an unknown `framework` option or `--framework` value names every runner the scan reads; it still named
  only Playwright, Vitest and Jest.

- [#89](https://github.com/Huldoser/test-inventory/pull/89) [`fd4b13a`](https://github.com/Huldoser/test-inventory/commit/fd4b13a45ec2349319b5edaec4dd0cbe1170d663) - `--help` names all nine runners `--framework` takes, and says which files node:test and Bun run without globs.

- [#80](https://github.com/Huldoser/test-inventory/pull/80) [`cae53c1`](https://github.com/Huldoser/test-inventory/commit/cae53c107fce5a3024f7666c83d9b2582bb9017b) - A helper that takes a test's function as a parameter, as `function settlementTest(desk, body) { describe(desk, () =>
test('settles', body)); }`, no longer gets a false `nested-test` warning. The scan read the parameter as the helper
  itself, and so read the helper's own describe as declared inside the test.

- [#78](https://github.com/Huldoser/test-inventory/pull/78) [`1aea8a7`](https://github.com/Huldoser/test-inventory/commit/1aea8a744c955a01f1918447e048046a4eb022b4) - oxc-parser is updated from 0.156.0 to 0.157.0. The scan output doesn't change, except that a `.js` file with
  TypeScript-only syntax, such as `export default abstract class` or an optional class member, now gets a `parse-error`, as
  Node.js would refuse to load it.

- [#80](https://github.com/Huldoser/test-inventory/pull/80) [`cae53c1`](https://github.com/Huldoser/test-inventory/commit/cae53c107fce5a3024f7666c83d9b2582bb9017b) - A test or describe call with a title the runner refuses, written inside a test or hook body, is now a `nested-test`
  warning, not an error that says the runner fails the file. Jest's own suite calls `it('test1')` inside
  `expect(() => ...)` to test that error; the call runs in the test, so the file loads and its tests run.

- [#80](https://github.com/Huldoser/test-inventory/pull/80) [`cae53c1`](https://github.com/Huldoser/test-inventory/commit/cae53c107fce5a3024f7666c83d9b2582bb9017b) - Before Vitest 4.1, a `retry` object in the config, as `test: { retry: { count: 2 } }`, now gets a
  `config-value-unknown` warning that Vitest runs no test with it. The tests already had `retries: null`, but nothing
  said why.

- [#80](https://github.com/Huldoser/test-inventory/pull/80) [`cae53c1`](https://github.com/Huldoser/test-inventory/commit/cae53c107fce5a3024f7666c83d9b2582bb9017b) - A call through a Vitest member that reads the function it is called on, destructured as in
  `const { each } = test; each([1, 2])('sizes lot %i', fn)`, is now an `invalid-chain` error, and the file's tests are
  `notLoaded`: Vitest fails the file. That holds for `each`, `for`, `skipIf` and `runIf` of `test` and `each` of
  `describe` in every version, `extend`, `scoped` and `override` from Vitest 4.1, and `for` of `describe` from Vitest 5.
  Before, the scan said nothing and listed the file's other tests as active.

- [#80](https://github.com/Huldoser/test-inventory/pull/80) [`cae53c1`](https://github.com/Huldoser/test-inventory/commit/cae53c107fce5a3024f7666c83d9b2582bb9017b) - An inline Vitest project in `test.projects` now runs from the config's `test.root` or `root` when it sets none of its
  own, as every Vitest version does; the scan used the config's folder before Vitest 5. A root the project sets is
  resolved from the config's root in Vitest 5, as Vitest 5 does, and from the config's folder before.

- [#85](https://github.com/Huldoser/test-inventory/pull/85) [`90df9aa`](https://github.com/Huldoser/test-inventory/commit/90df9aa07741fab403470e653595b1b644b35dc3) - With `expandCases`, a Vitest case title cuts long values at the length the config sets, `test.taskTitleValueFormatTruncate`
  from Vitest 5 and `test.chaiConfig.truncateThreshold` before, as Vitest does; it cut them at Vitest's default, 40, always.

- [#80](https://github.com/Huldoser/test-inventory/pull/80) [`cae53c1`](https://github.com/Huldoser/test-inventory/commit/cae53c107fce5a3024f7666c83d9b2582bb9017b) - From Vitest 5, `timeout: undefined`, `retry: undefined` and `repeats: undefined` in a test's options are left out, as
  Vitest leaves them out, instead of giving an `unresolved-option` warning that `undefined` is not a whole number.

## 0.8.0

### Minor Changes

- [#75](https://github.com/Huldoser/test-inventory/pull/75) [`f6690bb`](https://github.com/Huldoser/test-inventory/commit/f6690bbe5e49ce048ec4169f21bed23f702942d1) - `--framework` (library: `framework`) is now optional. Without it, the scan takes the runner the project uses: the one
  whose package a `package.json` in the root or below it lists, or whose config file is there, else one a `package.json`
  above the root lists. A project with several runners, or none, gets a usage error (a `TypeError` in the library) that
  names what it found.

- [#75](https://github.com/Huldoser/test-inventory/pull/75) [`f6690bb`](https://github.com/Huldoser/test-inventory/commit/f6690bbe5e49ce048ec4169f21bed23f702942d1) - Jest 29 and 30: `--framework jest` (library: `framework: 'jest'`) lists the tests of Jest files with the same keys as
  Playwright and Vitest tests. It reads Jest's globals, `fit`, `xit`, `xtest`, `fdescribe` and `xdescribe` among them,
  imports and `require()` of `@jest/globals`, the chains Jest has, such as `test.concurrent.only.each`, `.failing` as
  `expectedToFail`, the timeout passed third, `jest.retryTimes()` as `retries` for every test of the file (from 30.5,
  with `entireDescribe`, of its describe) and `waitBeforeRetry` as `retryDelay`, and `@group` pragmas as tags, as
  jest-runner-groups reads them. `--expand-cases` titles each case as jest-each 29 and 30 do. Calls Jest refuses, such
  as `test.only.concurrent`, `test('title')` without a function or an async describe, mark the file's tests `notLoaded`.

  Without globs, the test files come from the Jest config, read as Jest reads it: `jest.config.*`, else `package.json`,
  with `roots`, `testMatch`, `testRegex`, the ignore patterns, `moduleFileExtensions`, `projects` named by
  `displayName`, `testTimeout` and `injectGlobals`, also through Jest 30.3's `defineConfig()` and `mergeConfig()`;
  without any config, Jest's defaults apply. `framework` in the output
  can now be `jest`, an open set, so `schemaVersion` stays 1.

  The `cases-not-expanded` message no longer names Vitest, as Jest tables can get it too.

### Patch Changes

- [#75](https://github.com/Huldoser/test-inventory/pull/75) [`f6690bb`](https://github.com/Huldoser/test-inventory/commit/f6690bbe5e49ce048ec4169f21bed23f702942d1) - `require()` of a local file is followed as an import is: tables, titles and other values it exports, with
  `module.exports` or `exports.name`, are read, and helper functions it exports that declare tests are followed. A
  helper function a shared file imports and exports again, as an `index.js` of helpers does, is followed to where it is
  written, instead of getting an `unresolved-test-import` error. A helpers file may export a test function it takes from
  the runner's globals, as `export const pendingTest = xit`, or from the framework's module, with its modifiers.

- [#75](https://github.com/Huldoser/test-inventory/pull/75) [`f6690bb`](https://github.com/Huldoser/test-inventory/commit/f6690bbe5e49ce048ec4169f21bed23f702942d1) - A call the runner refuses, such as `test.only.skip(...)`, that is only reached under a condition no longer marks every
  test of its file `notLoaded`, as the file loads unless the condition holds; the call is still reported. A test function
  chosen with `&&`, `||` or `??`, as in `const onCi = process.env.CI && test.skip || test`, is read like one chosen with
  `?:`. In a config, a list with a spread the scan can't work out keeps the items it can.

- [#75](https://github.com/Huldoser/test-inventory/pull/75) [`f6690bb`](https://github.com/Huldoser/test-inventory/commit/f6690bbe5e49ce048ec4169f21bed23f702942d1) - A config that `require()`s a local file, as a CommonJS config does with a shared base, now reads what that file
  exports, as an `import` of it already did, and a JSON file, required or imported, is read as its value.

- [#75](https://github.com/Huldoser/test-inventory/pull/75) [`f6690bb`](https://github.com/Huldoser/test-inventory/commit/f6690bbe5e49ce048ec4169f21bed23f702942d1) - A table or loop gets its `caseCount` when its length is known even if one of its values isn't, as in
  `[NaN, Infinity].forEach(...)` or a table with a call in a row. A test or describe titled by a function or class
  written in place, as `describe(function OrderBook() {}, ...)`, takes its name, as the runners do. Code the parser
  fails to hand over, such as a JSX name written as a Unicode escape, gets a `parse-error` instead of an
  `internal-error`.

- [#75](https://github.com/Huldoser/test-inventory/pull/75) [`f6690bb`](https://github.com/Huldoser/test-inventory/commit/f6690bbe5e49ce048ec4169f21bed23f702942d1) - `dependencyHash` is faster on large projects: the files a test file and its describes reach are put together once for
  all their tests, and a workspace's packages are found once, not once per folder that imports one. A scan of the Nx
  repository with 17,571 tests went from 19.4 to 11.9 seconds. Hashes are unchanged.

## 0.7.0

### Minor Changes

- [#72](https://github.com/Huldoser/test-inventory/pull/72) [`cf784f0`](https://github.com/Huldoser/test-inventory/commit/cf784f070e66523df1d68c546f033e1f495f0f49) - `--expand-cases` (library: `expandCases: true`) lists each case of a `.each` or `.for` table and each pass of a loop
  whose values the scan can work out as its own record, with the title the runner gives it. Vitest's titles follow the
  rules of the project's Vitest version, 3.0 to 5: `%s`, `%d`, `%i`, `%f`, `%j`, `%o`, `%O`, `%c`, `%#`, `%$` and `$name`,
  with values quoted and cut as that version does; they match the names Vitest 3.0, 3.1, 3.2, 4.0, 4.1 and 5.0 list.
  Each case's values are bound in its callback, so titles, tags and conditions built from them are worked out per case,
  and an `if`, `?:`, `&&`, `||` or `??` that reads nothing but them registers only the branch it takes. Loops in test
  and hook bodies and loops over a `var` are not expanded, and a file starts expansions up to 1,000 loop passes and
  describe cases.
  Suites and tests have a new key, `caseIndex`: the case's index from 0, as `%#` counts, or `null` without the option. A
  table that can't be expanded stays one record with a new `cases-not-expanded` warning. Without the option the output
  is as before, apart from `caseIndex: null` on every suite and test.

- [#72](https://github.com/Huldoser/test-inventory/pull/72) [`cf784f0`](https://github.com/Huldoser/test-inventory/commit/cf784f070e66523df1d68c546f033e1f495f0f49) - Values imported from other files of the project are now worked out: a title, tag, annotation, reason, run setting or
  `.each` table built from a constant, enum or default export of another module, through re-exports, `export *`,
  `import * as` and JSON files, found the same way as helper functions (relative paths, tsconfig `paths`, `#imports`,
  workspace packages). Values from installed packages are still not read, and keep their diagnostic.

  A test in a `for...of`, `for...in`, `forEach` or `map` loop over values the scan can work out now has `caseCount`, the
  number of tests the runner registers, and no `test-in-loop` warning; the warning now marks a loop the scan can't
  count. Values also work out arithmetic on numbers, as in `30 * 1000`, `?:`, `&&`, `||`, `??`, comparisons,
  `Object.keys()`, `Object.values()`, `Object.entries()`, `JSON.stringify()`, `String()`, and a string's `toUpperCase()`,
  `toLowerCase()` and `trim()` and an array's `join()`. A skip condition that works out to a constant, such as
  `side === 'short'` in a helper called with `'buy'`, now sets the state it gives instead of being kept as a condition.

  Code after an `if` whose branch always returns or throws, as in `if (!strategy.enabled) return;` in a helper, is now
  under the opposite condition, so its tests have `isInCondition` and a loop around them no count. A tagged-template
  table is counted as Vitest splits it: outer pipes are columns, an incomplete last row is left out, and a template
  without values is one case.

  A test whose title was its source text and is now worked out gets a new `id`, once.

### Patch Changes

- [#71](https://github.com/Huldoser/test-inventory/pull/71) [`bf8383f`](https://github.com/Huldoser/test-inventory/commit/bf8383f009a73a026d128cd8e050505cdd63cfb5) - A name destructured from a test object, as in `const { describe, beforeEach } = test`, is now read as that member:
  `beforeEach(...)` is a hook, `describe(...)` a describe and `skip(...)` a skipped test, for Playwright and Vitest,
  also nested, as in `const { describe: { serial } } = test`. Every such name was read as `test` itself, so a hook got
  `test-without-body` and every test of the file `notLoaded`, and the tests inside a describe were left out with
  `nested-test` warnings.

- [#71](https://github.com/Huldoser/test-inventory/pull/71) [`bf8383f`](https://github.com/Huldoser/test-inventory/commit/bf8383f009a73a026d128cd8e050505cdd63cfb5) - When the root and the folders above it don't have the framework, its version is now read from the shallowest
  `package.json` below the root that declares it and holds scanned files, as `code/package.json` in a monorepo, with
  that package's lockfile or installed copy first. The version was `null` there, so the newest rules applied: Vitest
  5's, which refuse a file that calls `vi.mock` inside a block, made every test of such a file `notLoaded` in a project
  on Vitest 3.

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
