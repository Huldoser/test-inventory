# Real projects

CI scans the test suites of well-known open-source projects at pinned commits on every pull request, and a few of
them were checked against the runners' own lists. `npm run corpus` repeats the scans; the list of projects is in
[`tests/compare/corpus.json`](https://github.com/Huldoser/test-inventory/blob/main/tests/compare/corpus.json),
with the number of files and tests each scan found. A scan fails when it finds fewer, when a file gets a
`parse-error` or `internal-error`, or when a file calls `test`, `it` or `describe` but gets neither a test record nor
an error that says why.

## Scans

Each scan ran the command line in its own process, the median of five runs, on a desktop Ryzen 7 9800X3D under WSL 2
with Node.js 26.9. Folders named `fixtures` and `__fixtures__` are left out: they hold test inputs, some with syntax
errors on purpose, that the projects' runners never load.

| Project                                                                                             | Framework  | Files |  Tests | Time   | Peak memory |
| --------------------------------------------------------------------------------------------------- | ---------- | ----: | -----: | ------ | ----------: |
| [freeCodeCamp/freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp) `34b1acd`, end to end     | Playwright |    84 |    268 | 0.28 s |       93 MB |
| [vuejs/core](https://github.com/vuejs/core) `4ab865a`                                               | Vitest     |   196 |  3,592 | 1.22 s |      191 MB |
| [sveltejs/kit](https://github.com/sveltejs/kit) `3bc9234`, test apps                                | Playwright |    10 |    404 | 0.36 s |      100 MB |
| [sveltejs/kit](https://github.com/sveltejs/kit) `3bc9234`, unit                                     | Vitest     |    78 |    705 | 0.46 s |      105 MB |
| [microsoft/playwright](https://github.com/microsoft/playwright) `4357c23`                           | Playwright |   538 |  1,489 | 2.02 s |      206 MB |
| [supabase/supabase](https://github.com/supabase/supabase) `18080d8`, end to end                     | Playwright |    32 |    263 | 0.31 s |      108 MB |
| [supabase/supabase](https://github.com/supabase/supabase) `18080d8`, unit                           | Vitest     |   815 |  8,113 | 2.05 s |      196 MB |
| [storybookjs/storybook](https://github.com/storybookjs/storybook) `e57cf30`                         | Vitest     |   827 |  9,456 | 2.12 s |      214 MB |
| [TanStack/router](https://github.com/TanStack/router) `663282b`, end to end                         | Playwright |   309 |    203 | 0.61 s |      132 MB |
| [TanStack/router](https://github.com/TanStack/router) `663282b`, unit                               | Vitest     |   450 |  4,801 | 1.88 s |      221 MB |
| [vitejs/vite](https://github.com/vitejs/vite) `b6c20f6`                                             | Vitest     |   180 |  1,893 | 0.57 s |      151 MB |
| [vitest-dev/vitest](https://github.com/vitest-dev/vitest) `3e3624c`                                 | Vitest     |   509 |  3,434 | 1.03 s |      177 MB |
| [nuxt/nuxt](https://github.com/nuxt/nuxt) `0296ca4`                                                 | Vitest     |   266 |  2,603 | 0.84 s |      170 MB |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) `4c00f31`                         | Vitest     |   142 |  2,154 | 0.83 s |      187 MB |
| [getsentry/sentry-javascript](https://github.com/getsentry/sentry-javascript) `dffd6b1`, end to end | Playwright |   714 |  2,188 | 1.26 s |      174 MB |
| [getsentry/sentry-javascript](https://github.com/getsentry/sentry-javascript) `dffd6b1`, unit       | Vitest     |   853 | 10,120 | 2.48 s |      215 MB |

No scan had a `parse-error` or `internal-error`. Most diagnostics are warnings about values the scan can't work out
without running the code: titles built in loops, `.each` tables built by functions, and tests declared in loops. The
errors and the larger warning counts have these causes:

- **Playwright's own suite, 428 `unresolved-test-import` errors.** Its tests import `test` from fixtures files such
  as `pageTest.ts` and `browserTest.ts`, which build it in several layers from other local files and pick a browser,
  Android or Electron test object at run time. Only one file is followed, so these tests are missing and each import
  is reported. Two more files import it from a folder that re-exports a pinned Playwright with
  `module.exports = require(...)`. Its 23 `local-test-object` warnings are variables such as
  `const it = base.extend(...)` over those same layered objects, read on trust. Its one `state-in-helper` warning is
  a `test.skip()` inside a fixture, which skips the tests that use the fixture. The framework version is unknown
  because the repository is Playwright itself.
- **TanStack Router end to end, 216 `unresolved-test-import` errors.** 213 files import `test` from
  `@tanstack/router-e2e-utils`, a package of the same repository. The checkout is not installed, so the package is
  not linked into `node_modules` and can't be followed. In the other 3, a helper module re-exports `test` from another
  local file.
- **Nuxt, 24 `unresolved-test-import` errors.** Playwright tests that the Vitest pattern also matches import `test`
  from a helper that builds it from `@nuxt/test-utils/playwright`.
- **Sentry unit, 21 `unresolved-test-import` errors.** 7 files are Bun tests that import `test`, `it` and
  `describe` from `bun:test`, and 5 import them from `@effect/vitest`, an installed package that wraps Vitest. Each
  name is reported once per file.
- **Vue core, 80 `test-in-function` warnings.** `render.spec.ts` declares its tests in `testRender()`, which it calls
  three times, once for each way to render, and `Teleport.spec.ts` calls `runSharedTests()` in an eager and a defer
  describe. Vitest registers those tests once per call, in the describe around the call; the scan lists each test once,
  where it is written. Seven other projects have a few such warnings, 72 in all, such as freeCodeCamp's
  `donatePageTests()`, which runs in a signed-in and a signed-out describe.
- **Vite, 11 `local-test-object` warnings.** `const it = await createModuleRunnerTester(...)` builds a test object
  from a helper; its calls are read as tests.
- **Vitest's own suite.** 10 `nested-test` warnings come from tests written inside test bodies, which Vitest's
  own tests serialize and run in a separate Vitest. The one `globals-not-enabled` warning is from the same code,
  which runs there with `globals: true`. The framework version is unknown because the repository is Vitest itself.
- **Sentry end to end.** One `framework-mismatch`: a Vitest file inside a Playwright test app. One `nested-test`: a
  `test.skip` written inside another test's body, which Playwright never collects.

## Compared with the runners

Three of the projects were installed and listed with their own runner, and the lists were matched with the scan by
file and line, as described in [Compared with the runners](/guide/runners).

| Project and runner                                   | Records | Listed by the runner | Differences |
| ---------------------------------------------------- | ------: | -------------------: | ----------: |
| supabase `e2e/studio`, Playwright 1.59.1             |     253 |                  256 |           0 |
| Vite `packages`, Vitest 5.0.3                        |     878 |                1,036 |           4 |
| TanStack Router `packages/router-core`, Vitest 4.1.4 |   1,486 |                3,643 |           7 |

The runners list more tests because they repeat a test for each loop iteration and each `.each` case, which the
scan keeps as one record with `isInLoop` or `caseCount`. Every difference has a known cause:

- Vite: three tests inside `if (isWindows)` are not collected on Linux; the scan marks them `isInCondition`. One
  `test.skip` test is missing from `vitest list`, which leaves out skipped and todo tests.
- TanStack Router: two `test.skip` tests are missing from `vitest list` for the same reason. Three skipped tests are
  in a `*.perf.test.ts` file that the package's Vitest config excludes, while the scan's pattern included it. Two
  type tests share a title, and Vitest lists type tests without a line, so each matches both entries.
