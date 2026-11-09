---
description: Understand declarations, states, conditions, counts, ids and hashes before using an inventory to make decisions.
---

# Key concepts

## A declaration is not a test result

The inventory describes tests found in source code. It does not tell you whether they passed, how long they took or
whether a condition held on a particular machine. Use your runner's report for those answers.

The scanner reads configs and follows supported project imports without executing them. Some declarations cannot
be found this way. Check `diagnostics` before treating a scan as complete; [known limits](/guide/limits) also lists
cases that cannot produce a diagnostic.

## State describes the code

| State                   | Meaning                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active`                | No skip, fixme, todo, expected-failure or load-failure state was found. This is not proof that a run selects or passes the test.                                                                           |
| `skip`, `fixme`, `todo` | The code marks the test with that state. The runner decides what it executes; for example, node:test can mark a running body todo.                                                                         |
| `expectedToFail`        | The runner is expected to execute the test and check that it fails. It is not a disabled test.                                                                                                             |
| `notLoaded`             | A declaration would be unavailable because the runner refuses the containing file or suite, or stops collecting part of it. See [failure scopes](/reference/diagnostics#files-the-runner-refuses-to-load). |

Exactly one state boolean is true. `isActive: false` means the state is something other than `active`; it does not
mean the body never runs.

When `isConditional` is true, the state applies only when `condition` holds. A test with `state: "fixme"` and
`condition: "browserName === 'webkit'"` may run normally in Chromium. Keep the condition alongside the state in
reports. Even an unconditional runtime skip may execute part of a body before reaching the skip call.

`isOnly` is separate from state. Focus, project selection and runner arguments can leave an otherwise active test
out of a run.

## Counts describe declarations by default

A loop or `.each` table normally contributes one test record. `caseCount` gives its number of executions when the
scanner can determine it. With `--expand-cases`, known cases become separate records; cases that cannot be expanded
remain one record with a diagnostic.

Browser instances and projects are listed in `projects`. A declaration used by two projects remains one test record,
not two. Retries and repeats do not multiply `summary.testCount` either.

## Ids identify declarations; hashes compare code

- `id` stays the same when a test moves to another line. Changing its file, title or suite path can change its id.
- `bodyHash` describes the test function's syntax tree. Formatting and comments do not change it. Equal bodies do
  not prove that two tests exercise the same behavior.
- `dependencyHash` also includes the project code, fixtures, hooks, config and supported data dependencies the test
  reaches. Installed packages and runtime inputs are outside that hash.

Compare hashes only between scans made with the exact same core version. The [diff guide](/guide/diff) explains
rename matching and incomplete comparisons.

## Related tests are candidates

`--related` keeps tests whose dependencies include a changed file and tests with unfollowed dependencies. It can
therefore return more tests than the change actually affects. Network behavior, runtime file reads and installed
packages can also connect tests to changes the scanner does not see.

Use the list to guide investigation. It is not proof that every test left out is safe to omit from CI. See
[dependency limits](/guide/limits#what-dependencyhash-leaves-out).

## Missing values are explicit

A complete record always contains every key. `null` means a value is absent or could not be determined, `[]` is an
empty list, and `false` is a boolean value. The related source keys and diagnostics distinguish inherited, unknown
and unset settings. `--fields` intentionally produces partial test records; these cannot be used for inventory diffs.
