---
description: How the inventory differs from playwright test --list and vitest list, and how CI compares them.
---

# Compared with the runners

Playwright and Vitest can list their tests too: `playwright test --list --reporter=json` and
`vitest list --json`. Both load the test files, and so run the code at the top level of every file. test-inventory
reads the files without running them.

|                                | test-inventory                       | `playwright test --list`     | `vitest list`                   |
| ------------------------------ | ------------------------------------ | ---------------------------- | ------------------------------- |
| Runs code from the test files  | No                                   | Yes, top level and describes | Yes, or parses them in Vitest 5 |
| Needs the runner installed     | No                                   | Yes                          | Yes                             |
| Loops and `.each` tables       | One record, with the number of cases | One test per iteration       | One test per case               |
| Skipped and todo tests         | Listed, with the state               | Listed                       | Left out                        |
| Skip conditions                | Kept as source text                  | Evaluated at load time       | Not shown                       |
| Tags                           | As written, `@smoke`                 | Without the `@`, `smoke`     | Not shown                       |
| Stable id and body hash        | Yes                                  | No                           | No                              |
| One schema for both frameworks | Yes                                  | No                           | No                              |

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

## Checked in CI

On every pull request, CI scans the fixture projects in the repository and compares the inventory with Playwright
1.42, 1.63 and 1.64 and Vitest 3.0 and 5.0. Playwright lists the tests with `--list`; Vitest runs them with its JSON
reporter, which, unlike `vitest list`, includes skipped and todo tests. Each test is matched by file and line, and
its full title, its state and its tags are compared. A state set by a condition is left out, since the runner
decides it on the machine it runs on. Any difference fails the check.

The [real projects](/guide/real-projects) that use Vitest are compared too, with Vitest's static parser, which lists
their tests without an install. The scan applies the rules of the same Vitest version. Each difference must have a
known cause, such as one of the parser's differences above; one without fails the check, which doesn't block a
merge, since it clones the projects over the network.
