# Contributing

Thanks for helping. Bug reports with a short test file that shows the problem are the most useful contribution.

## Setup

Node.js 22.18 or newer (the scripts in `scripts/` run as TypeScript), then:

```sh
npm ci
npm test
```

| Command                                               | Does                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm test`                                            | Builds `dist/`, then runs every test.                                                  |
| `npm run coverage`                                    | The tests with coverage. Every file in `src/` must stay at 100%.                       |
| `npm run typecheck`                                   | Type checks the sources, scripts and tests.                                            |
| `npm run lint`, `npm run format`                      | ESLint and Prettier.                                                                   |
| `npm run schema`                                      | Regenerates `schema/v1.json` from `src/types.ts`.                                      |
| `npm run test:pack`                                   | Packs the package, installs it in a temporary project and uses it.                     |
| `npm run publint`, `npm run attw`, `npm run licenses` | Checks the package metadata, its types and the licenses of its dependencies.           |
| `npm run compare -- vitest 5.0.3`                     | Lists the fixture tests with a real runner and compares the list with the inventory.   |
| `npm run docs:dev`                                    | The docs site at localhost.                                                            |
| `npm run corpus`                                      | Scans the open-source projects in `tests/compare/corpus.json` at their pinned commits. |
| `npm run release -- --dry-run`                        | Checks and prints the steps of a release without changing anything.                    |
| `node scripts/outdated.ts --dry-run`                  | Lists the dependencies with a newer version, as the weekly issue does.                 |

## How the code is laid out

- `src/types.ts` is the output format. `schema/v1.json` is generated from it; a test fails when it is out of date.
- `src/frameworks/` reads Playwright and Vitest calls. `src/extract.ts` walks a file and `src/records.ts` turns what it
  found into records.
- `tests/fixtures/` holds realistic projects of a made-up trading app, one per common setup: Playwright end-to-end
  tests, a Node.js service, React, Vue, browser mode and a monorepo. `tests/examples.ts` lists them, and
  `tests/golden/` holds their scan output. `tests/fixtures/syntax` holds one file per framework that uses every form
  the scanner reads, and one with the forms for which the runner refuses the whole file.

## Tests

- Name tests by the behaviour they check.
- New examples belong to the trading app: orders, quotes, portfolios, strategies. Keep them believable.
- When a change alters the output on purpose, update the golden files with `npx vitest run tests/golden.test.ts -u`
  and review the diff. CI never rewrites them.
- Every output a test produces is checked against the JSON Schema.

## Docs

A pull request that changes `src/` or `schema/` changes the docs too, or says why not: the "Docs required" check
fails until a file in `docs/` or `README.md` changes, the "No docs change is needed" box in the pull request template
is ticked, or a maintainer adds the `no docs` label. A release pull request, which only changes `CHANGELOG.md`,
`package.json`, `package-lock.json` and `.changeset/`, passes on its own.

`tests/docs.test.ts` keeps the docs true to the code. An HTML comment above a code block says where it comes from:

- `<!-- code: trading-web/tests/alerts.spec.ts -->`: the block is in that fixture file. A `// ...` line stands for
  lines left out.
- `<!-- output: trading-web -->`: every key in the JSON block has the same value in that fixture's golden output.
  Every JSON block needs one.
- `<!-- scan: trading-web -->`: the command scans that fixture with the patterns in `tests/examples.ts`.
- `<!-- recipe: trading-web -->`: above a Node.js recipe, which runs on that fixture's golden output and must print
  the next block.
- `<!-- types: ScanOptions, Framework -->`: no block is written. The docs build puts those declarations there, with
  their comments, as they are in `src/`, so the docs never show a type that differs from the code.

It also checks that the reference pages list every diagnostic, command line option and output key.

## Changesets

Every change that affects users carries a changeset. Run `npx changeset` and describe the change in a sentence.

Before 1.0:

- A breaking change, including one to the output format, is `minor`. Never choose `major`: it would release 1.0.0.
- A new feature is `minor`.
- A fix is `patch`.

When the output changes, follow the versioning rules on the [output page](https://huldoser.github.io/test-inventory/reference/output#versioning).

## Releases

Releases are made from `main`. Changesets collect there until a maintainer releases them; nothing is published until a
release pull request is merged.

1. On an up-to-date `main` with no local changes, run `npm run release`. It checks that `main` matches GitHub and that
   changesets are waiting, makes a `release-x.y.z` branch, runs `changeset version`, updates the lockfile, commits
   "Release x.y.z", pushes the branch and opens the pull request, with gh when it is installed and otherwise through a
   link it prints. `changeset version` reads a GitHub token to link each change to its pull request: `GITHUB_TOKEN`
   when it is set, otherwise the one gh is logged in with. `npm run release -- --dry-run` shows the steps first.
2. Review the new `CHANGELOG.md` entry and the version in the pull request, and squash merge it when the checks pass.
3. The push to `main` starts the Release workflow. It builds, tests and packs the package, publishes it to npm with
   provenance, pushes the `vx.y.z` tag, creates the GitHub release and deploys the docs. Merging is the approval: only
   `main` may use the `npm` environment, and the ruleset on `main` requires a pull request with passing checks.
4. npm lists the new version a few minutes after the run publishes it. Check with
   `npm view test-inventory@x.y.z --prefer-online`. Until then it finds nothing; don't re-run the publish job, as npm
   already has the version.

The same steps by hand, if the script can't be used:

1. Branch from an up-to-date `main`, for example `release-0.2.0`.
2. Run `GITHUB_TOKEN=$(gh auth token) npx changeset version`. It raises the version in `package.json`, writes
   `CHANGELOG.md` and deletes the changesets it used. The token is set for this one command and stored nowhere.
3. Run `npm install --package-lock-only` so that `package-lock.json` has the new version too.
4. Commit as "Release x.y.z", push, and open a pull request, then continue from step 2 above.

npm publishes with trusted publishing: the package's trusted publisher on npmjs.com names this repository, `release.yml`
and the `npm` environment, and allows `npm publish`. It must exist before a release pull request is merged, or the
publish fails with `E404 Not Found`; no npm token is involved. A maintainer with two-factor authentication sets it up
on the package's settings page on npmjs.com, or in a terminal:

```sh
npm trust github test-inventory --file release.yml --repo Huldoser/test-inventory --env npm --allow-publish
```

The workflow creates the tags. To create one by hand, use `npx changeset git-tag`, never `changeset tag`, which is a
deprecated name for it.

### Docs between releases

The site normally changes with a release. To ship a docs fix sooner, run the Docs workflow from the Actions tab. With
`ref` empty it builds the docs of the latest release tag; with `ref` set to `main` it builds `main`, which is right
only when `main` has no unreleased changes that the docs describe.

### When a release goes wrong

- **The version is on npm, but there is no tag or GitHub release**, for example when the workflow failed after
  publishing. Running it again doesn't help: it sees that the version is published and does nothing. On the release
  commit, run `npx changeset git-tag`, push the tag with `git push origin vx.y.z`, and create the GitHub release for
  that tag with the `CHANGELOG.md` entry as its notes.
- **A release is broken.** Deprecate it first, so that new installs warn, with a message that says what is wrong and
  which version to use: `npm deprecate test-inventory@x.y.z "<message>"`. Then release the fix as a patch.
- **Unpublishing** is only for the first 72 hours after a publish, and a version number can never be used again, even
  after it is unpublished. Prefer deprecating.

## Dependencies

Dependencies stay on their newest versions. Every Monday a workflow opens or updates the "Outdated dependencies"
issue; nothing updates them automatically. A dependency held back on purpose is listed in `scripts/outdated.ts` with
the reason, and the issue shows it apart.

## Pull requests

Keep a pull request to one change. Its title becomes the commit message when it is merged, so write it as a sentence
that says what the change does.
