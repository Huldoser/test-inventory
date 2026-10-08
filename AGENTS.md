# AGENTS.md

Notes for coding agents working in this repository. People should read CONTRIBUTING.md.

## Commands

- `npm ci` to install, Node.js 22.18 or newer.
- `npm test` builds `dist/` and runs all tests; `npm run coverage` must report 100% for every file in `src/`.
- `npm run typecheck`, `npm run lint` and `npm run format:check` must pass.
- `npm run schema` after any change to `src/types.ts`.

## Layout

- `src/types.ts`: the output format and the source of `schema/v1.json`.
- `src/frameworks/playwright.ts`, `src/frameworks/vitest.ts`: which calls are tests, describes or modifiers.
- `src/extract.ts`: walks one file. `src/records.ts`: builds records, ids and hashes. `src/scan.ts`: files and versions.
- `src/resolve.ts`: finds the file a test object is imported from: relative paths, tsconfig paths, `#imports`, workspaces.
- `tests/fixtures/`: realistic trading-app projects and per-framework syntax files. Never run by the test suite.
- `tests/golden/`: expected scan output, updated only with `npx vitest run tests/golden.test.ts -u` and reviewed.
- `tests/docs.test.ts`: checks the docs against the fixtures. Code and JSON blocks in docs carry a `<!-- code: -->`,
  `<!-- output: -->`, `<!-- scan: -->` or `<!-- recipe: -->` comment; see CONTRIBUTING.md.

## Conventions that are easy to get wrong

- Every key in a record is always present: `false`, `[]` or `null`, never `undefined` or missing.
- Output must be deterministic: no timestamps, no absolute paths, paths with `/`.
- Lines and columns are 1-based UTF-16 code units, the way editors count.
- A test id must not change when the test moves to another line.
- Code problems become diagnostics; only invalid options throw, and only `TypeError`.
- Runtime dependencies are `oxc-parser` (exact version) and `tinyglobby` only. Ask before adding one.
- Comments explain why, not what. No coverage-ignore comments except for type-only modules and impossible defaults.
- Test examples use the made-up trading app. No toy titles like `test('a')`.
- Vitest reads `@module-tag` from the text of test files, so build that word from parts inside `tests/*.test.ts`.
- Changesets: breaking changes are `minor` before 1.0; never `major`.
- `npm run release` commits, pushes and opens a pull request. Run it only with `--dry-run`; releasing is for maintainers.
