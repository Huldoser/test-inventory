# test-inventory

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
