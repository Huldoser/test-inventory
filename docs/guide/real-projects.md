---
description: The open-source test suites CI scans at pinned commits on every pull request.
---

# Real projects

CI scans the test suites of well-known open-source projects at pinned commits on every pull request, and a few of
them were checked against the runners' own lists. `npm run corpus` repeats the scans; the list of projects is in
[`tests/compare/corpus.json`](https://github.com/Huldoser/test-inventory/blob/main/tests/compare/corpus.json),
with the number of files and tests each scan found. A scan fails when it finds fewer, when a file gets a
`parse-error` or `internal-error`, or when a file calls `test`, `it` or `describe` but gets neither a test record nor
an error that says why. The projects that use Vitest are also listed with Vitest's static parser and compared with
the scan, as described in [Compared with the runners](/guide/runners#checked-in-ci).

## Scans

Folders named `fixtures` and `__fixtures__` are left out: they hold test inputs, some with syntax errors on purpose,
that the projects' runners never load.

| Project                                                                                             | Framework  | Files |  Tests |
| --------------------------------------------------------------------------------------------------- | ---------- | ----: | -----: |
| [freeCodeCamp/freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp) `34b1acd`, end to end     | Playwright |    84 |    273 |
| [vuejs/core](https://github.com/vuejs/core) `4ab865a`                                               | Vitest     |   196 |  3,729 |
| [sveltejs/kit](https://github.com/sveltejs/kit) `3bc9234`, test apps                                | Playwright |    10 |    404 |
| [sveltejs/kit](https://github.com/sveltejs/kit) `3bc9234`, unit                                     | Vitest     |    78 |    707 |
| [microsoft/playwright](https://github.com/microsoft/playwright) `4357c23`                           | Playwright |   538 |  5,984 |
| [supabase/supabase](https://github.com/supabase/supabase) `18080d8`, end to end                     | Playwright |    32 |    263 |
| [supabase/supabase](https://github.com/supabase/supabase) `18080d8`, unit                           | Vitest     |   815 |  8,305 |
| [storybookjs/storybook](https://github.com/storybookjs/storybook) `e57cf30`                         | Vitest     |   827 |  9,464 |
| [TanStack/router](https://github.com/TanStack/router) `663282b`, end to end                         | Playwright |   309 |  1,487 |
| [TanStack/router](https://github.com/TanStack/router) `663282b`, unit                               | Vitest     |   450 |  4,801 |
| [vitejs/vite](https://github.com/vitejs/vite) `b6c20f6`                                             | Vitest     |   180 |  1,919 |
| [vitest-dev/vitest](https://github.com/vitest-dev/vitest) `3e3624c`                                 | Vitest     |   509 |  3,438 |
| [nuxt/nuxt](https://github.com/nuxt/nuxt) `0296ca4`                                                 | Vitest     |   266 |  2,603 |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) `4c00f31`                         | Vitest     |   142 |  2,216 |
| [getsentry/sentry-javascript](https://github.com/getsentry/sentry-javascript) `dffd6b1`, end to end | Playwright |   714 |  2,188 |
| [getsentry/sentry-javascript](https://github.com/getsentry/sentry-javascript) `dffd6b1`, unit       | Vitest     |   853 | 10,124 |

No scan had a `parse-error` or `internal-error`. Most diagnostics are warnings about values the scan can't work out
without running the code: titles built in loops, `.each` tables built by functions, and tests declared in loops. The
errors and the larger warning counts have these causes:

- **Playwright's own suite, 118 `unresolved-test-import` errors.** Its tests import `test` from fixtures files such
  as `pageTest.ts` and `browserTest.ts`, which build it in several layers from other local files; those are followed.
  98 imports end at the copy of Playwright that `tests/playwright-test/stable-test-runner` pins in its own
  `node_modules`, which a checkout without an install doesn't have. The other 20 are in `tests/installation`, whose
  `npmTest.ts` builds its test object on `_baseTest`, an internal export of Playwright, not on `test`. Its 4
  `local-test-object` warnings are variables such as `const test = baseTest.extend(...)` over that pinned copy, read
  on trust. Its one `state-in-helper` warning is a `test.skip()` inside a fixture, which skips the tests that use the
  fixture. The framework version is unknown because the repository is Playwright itself.
- **Nuxt, 24 `unresolved-test-import` errors.** Playwright tests that the Vitest pattern also matches import `test`
  from a helper that builds it from `@nuxt/test-utils/playwright`.
- **Sentry unit, 24 `unresolved-test-import` errors.** 7 files are Bun tests that import `test`, `it` and
  `describe` from `bun:test`, and 5 import them from `@effect/vitest`, an installed package that wraps Vitest. Each
  name is reported once per file.
- **Vue core, 217 tests in helper functions.** `render.spec.ts` declares its tests in `testRender()`, which it calls
  three times, once for each way to render, and `Teleport.spec.ts` calls `runSharedTests()` in an eager and a defer
  describe. The scan records those tests at each call, in the describe around it, as Vitest registers them. Other
  projects do the same in places, such as freeCodeCamp's `donatePageTests()`, which runs in a signed-in and a
  signed-out describe.
- **Vite, 11 `local-test-object` warnings.** `const it = await createModuleRunnerTester(...)` builds a test object
  from a helper; its calls are read as tests.
- **Vitest's own suite.** 10 `nested-test` warnings come from tests written inside test bodies, which Vitest's
  own tests serialize and run in a separate Vitest. The one `globals-not-enabled` warning is from the same code,
  which runs there with `globals: true`. The framework version is unknown because the repository is Vitest itself.
- **Sentry end to end.** One `framework-mismatch`: a Vitest file inside a Playwright test app. One `nested-test`: a
  `test.skip` written inside another test's body, which Playwright never collects.

## Compared with the runners

Three of the projects were installed and listed with their own runner, and the lists were matched with the scan by
file and line, as described in [Compared with the runners](/guide/runners). This was done with test-inventory 0.1.1,
before tests in helper functions were recorded at each call.

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
