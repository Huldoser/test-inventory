# AGENTS.md

Notes for coding agents working in this repository. People should read CONTRIBUTING.md.

## Commands

- `npm ci` to install, Node.js 22.18 or newer.
- `npm test` builds `dist/` and runs all tests; `npm run coverage` must report 100% for every file in `src/`.
- `npm run typecheck`, `npm run lint` and `npm run format:check` must pass.
- `npm run schema` after any change to `src/types.ts`.

## Layout

- `src/types.ts`: the output format and the source of `schema/v1.json`.
- `src/frameworks/`: a file per runner, with which calls are tests, describes or modifiers; the parts they share are in
  `common.ts`, `bindings.ts` and `test-functions.ts`.
- `src/extract.ts`: walks one file. `src/records.ts`: builds records, ids and hashes. `src/scan.ts`: files and versions.
- `src/resolve.ts`: finds the file a test object is imported from: relative paths, config aliases,
  tsconfig paths, `#imports`, workspaces.
- `tests/fixtures/`: realistic trading-app projects and per-framework syntax files. Never run by the test suite.
- `tests/golden/`: expected scan output, updated only with `npx vitest run tests/golden.test.ts -u` and reviewed.
- `tests/docs.test.ts`: checks the docs against the fixtures. Code and JSON blocks in docs carry a `<!-- code: -->`,
  `<!-- output: -->`, `<!-- scan: -->` or `<!-- recipe: -->` comment; see CONTRIBUTING.md. Types are never copied
  into the docs: a `<!-- types: -->` comment inserts them from `src/` when the docs are built.

## Conventions that are easy to get wrong

- Every key in a record is always present: `false`, `[]` or `null`, never `undefined` or missing.
- Output must be deterministic: no timestamps, no absolute paths, paths with `/`.
- Lines and columns are 1-based UTF-16 code units, the way editors count.
- A test id must not change when the test moves to another line.
- Code problems become diagnostics; only invalid options throw, and only `TypeError`.
- Runtime dependencies are `oxc-parser` (exact version), `picomatch` and `tinyglobby` only. Ask before adding one.
- A dependency's range follows the Dependencies section of CONTRIBUTING.md; `tests/dependencies.test.ts` checks it.
- Comments explain why, not what. No coverage-ignore comments except for type-only modules and impossible defaults.
- Test examples use the made-up trading app. No toy titles like `test('a')`.
- Vitest reads `@module-tag` from the text of test files, so build that word from parts inside `tests/*.test.ts`.
- Changesets: breaking changes are `minor` before 1.0; never `major`.
- Docs describe the code on `main` on every page that touches a behaviour: when you change one, search `docs/` and
  `README.md` for the old behaviour (runner lists, versions, defaults, rules) and update each place, not just one.
- `npm run release` commits, pushes and opens a pull request. Run it only when a maintainer asks for that release, after
  checking that the docs describe every pending changeset (CONTRIBUTING.md, Releases, step 1) and after
  `npm run release -- --dry-run`. It leaves the checkout on the release branch, so switch back to `main` afterwards. If
  it fails or is refused, stop and report; never run its steps by hand.
