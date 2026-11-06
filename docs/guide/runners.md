---
description: How the inventory differs from playwright test --list, vitest list, jest --collectTests, mocha --dry-run, and a Jasmine, Cypress, WebdriverIO, node:test or Bun run, and how CI compares them.
---

# Compared with the runners

The runners can list their tests too: `playwright test --list --reporter=json`, `vitest list --json`, from Jest 30.4
`jest --collectTests`, and `mocha --dry-run`. They load the test files, and so run the code at the top level of every
file. test-inventory reads the files without running them.

|                                | test-inventory                       | `playwright test --list`     | `vitest list`                   | `jest --collectTests`                      | `mocha --dry-run`            | `jasmine --reporter=…` | `cypress run --reporter=…`    | `wdio run` with a reporter    | `node --test --test-reporter=…`                              | `bun test --reporter=junit`                                       |
| ------------------------------ | ------------------------------------ | ---------------------------- | ------------------------------- | ------------------------------------------ | ---------------------------- | ---------------------- | ----------------------------- | ----------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Runs code from the test files  | No                                   | Yes, top level and describes | Yes, or parses them in Vitest 5 | Yes, top level and describes               | Yes, top level and describes | Yes, every spec        | Yes, every test, in a browser | Yes, every test, in a browser | Yes, every test                                              | Yes, every test                                                   |
| Needs the runner installed     | No                                   | Yes                          | Yes                             | Yes, Jest 30.4 or newer                    | Yes                          | Yes                    | Yes, and its browser          | Yes, and its browser          | No, it is Node.js's own                                      | Yes                                                               |
| Loops and `.each` tables       | One record, with the number of cases | One test per iteration       | One test per case               | One test per iteration, per case from 30.5 | One test per iteration       | One spec per iteration | One test per iteration        | One test per iteration        | One test per iteration                                       | One test per case                                                 |
| Skipped and todo tests         | Listed, with the state               | Listed                       | Left out                        | Listed, with the state                     | Listed as pending            | Listed as pending      | Listed as pending             | Listed as pending             | Skipped and todo listed; a skipped describe's tests left out | Skipped and todo listed; with `.only`, the file's others left out |
| Skip conditions                | Kept as source text                  | Evaluated at load time       | Not shown                       | Evaluated at load time                     | Not shown                    | Evaluated as specs run | Evaluated as tests run        | Evaluated as tests run        | Evaluated as tests run                                       | Evaluated as tests run                                            |
| Tags                           | As written, `@smoke`                 | Without the `@`, `smoke`     | Not shown                       | Not shown                                  | Not shown                    | Not shown              | Not shown                     | Not shown                     | Not shown                                                    | Not shown                                                         |
| Line of each test              | Yes                                  | Yes                          | Yes                             | No                                         | No                           | No                     | No                            | No                            | Yes                                                          | Yes                                                               |
| Stable id and body hash        | Yes                                  | No                           | No                              | No                                         | No                           | No                     | No                            | No                            | No                                                           | No                                                                |
| One schema for every framework | Yes                                  | No                           | No                              | No                                         | No                           | No                     | No                            | No                            | No                                                           | No                                                                |

## Matching records with the runners' lists

To match a record with a runner's entry, use the file and the line range: the entry's line falls between
`lineStart` and `lineEnd`. Columns differ: Playwright reports the column of the call's last name, `fail` in
`test.fail(`, or of its opening parenthesis, while test-inventory and Vitest report the column where the call
starts.

## Vitest 5's static list

`vitest list` in Vitest 5 parses the files instead of running them, unless `--no-static-parse` is given. Its results
differ from what the runner does: it treats any `.only` as applying to the whole run, lets the last modifier in a
chain win, and treats `runIf(true)` and `skipIf(false)` as skipped. It also keeps escapes such as `\"` in names as
written, drops a test or describe chained after a call, as in `describe.runIf(hasBroker).skip(...)`, and lists a
call such as `testRouting('NYSE')` as a test because its name starts with `test`. test-inventory follows what the
runner does.

## Jest's list

Jest 30.4 added `--collectTests`, which lists the tests without running them; from 30.5 it lists each case of a `.each`
table. It loads the test files and calls their describe callbacks, so Jest has to be installed and the files'
top-level code runs. Its entries have no line (`location` is `null`), so they match records by file and full title.
`jest --listTests` lists only the files. Jest 29 has neither, so the only way to see its tests there is to run them.

## Mocha's list

Mocha 9 added `--dry-run`, which reports every test as passed without running it, and pending tests as pending. It
loads the test files and calls their describe callbacks, so Mocha has to be installed and the files' top-level code
runs. A test that calls `this.skip()` is reported as passed, since its body doesn't run. Mocha's reporters give no line,
and the JSON reporter joins the titles with spaces, so a describe's title can't be told from the test's; entries match
records by file and full title.

## Jasmine's list

Jasmine has no way to list its specs without running them. A reporter, given with `jasmine --reporter=`, sees every
spec as it runs, with its file and status: `pending` for `xit`, a spec without a function and `pending()`, `excluded`
for the specs a `fit` or `fdescribe` leaves out, and from Jasmine 7 `notApplicable`. Its full names join the titles
with spaces, and it gives no line, so entries match records by file and full title. Karma runs Jasmine in a browser
and reports the same way.

## Cypress's list

Cypress has no way to list its tests without running them, and runs them in a browser. A Mocha reporter, given with
`cypress run --reporter`, sees each spec's tests as they run, with their status: `pending` for `.skip`, a test without
a function and a test that `this.skip()` or its `browser` option skips. Cypress starts the reporter once per spec, and
it gives no line, so entries match records by spec and full title.

## WebdriverIO's list

WebdriverIO has no way to list its tests either, and starts a browser session for each spec file. A reporter given in
the config's `reporters` sees each test as it runs, with `test:pending` for a skipped one. Its entries carry the
test's title and its describe's, but no line, so they match records by spec file and full title.

## node:test's list

`node --test` has no way to list its tests without running them. A reporter given with `--test-reporter` sees each
test as it starts and ends, with its file, line and depth, and whether it was skipped, todo or expected to fail. A
subtest is reported inside the test that runs it. A skipped describe, or a test skipped where it is declared, is
reported as one entry, without the tests inside it, which the inventory lists as skipped. Under `node --test`, `only`
applies only with `--test-only`; the inventory gives `isOnly` as written.

## Bun's list

`bun test` has no way to list its tests without running them either. Its JUnit report, `--reporter=junit`, gives each
test's file and line inside the describes around it, with `<skipped/>` for a skipped test and
`<skipped message="TODO"/>` for a todo one; a `.failing` test that throws is a plain pass. A `.only` makes Bun run only
the focused tests of its file, and leave the others out of the report; the inventory lists them all, with `isOnly` as
written.

## Checked in CI

On every pull request, CI scans the fixture projects in the repository and compares the inventory with Playwright 1.42,
1.63 and 1.64, Vitest 3.0 and 5.1, Jest 29.7 and 30.5, Mocha 10.8 and 12.0, Jasmine 4.6 and 7.0, Cypress 13.17 and 16.2,
WebdriverIO 9.33 and 10.1, node:test on Node.js 22.23, 24.22 and 26.13, and Bun 1.2.23, 1.3.14 and 1.4.4. Playwright
lists the tests with `--list`; Vitest and Jest run them with their JSON output, and Bun with its JUnit report, which,
unlike `vitest list`, includes skipped and todo tests; Mocha, Jasmine, node:test, Cypress, in Electron, and WebdriverIO,
in headless Chrome, run them with a reporter of the repository's own that keeps each title, so that `this.skip()` and
`pending()` are seen. Each test is matched by file and line, or by file and full title for Mocha, Jasmine, Cypress and
WebdriverIO, which give no line, and its full title, its state and its tags are compared; Jest, Mocha, Jasmine, Cypress,
WebdriverIO, node:test and Bun report no tags; node:test's subtests are matched by full title too, as their lines are inside
their parent's. A state set by a condition is left out, since the runner decides it on the machine it runs on. Any
difference fails the check.

The [real projects](/guide/real-projects) that use Vitest are compared too, with Vitest's static parser, which lists
their tests without an install. The scan applies the rules of the same Vitest version. Each difference must have a
known cause, such as one of the parser's differences above; one without fails the check, which doesn't block a
merge, since it clones the projects over the network.
