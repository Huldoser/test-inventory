---
description: Compare saved test inventories, follow renamed or moved tests, and report code, state and tag changes.
---

# Compare inventories

Save complete JSON scans from the base and head revisions of a project, then compare them:

```sh
test-inventory diff inventories/base.json inventories/head.json --pretty
test-inventory diff inventories/base.json inventories/head.json --format markdown --output changes.md
```

Use the same test-inventory version, framework, root, patterns, filters and `--expand-cases` setting for both scans.
Save the scans before changing revisions. Do not use `--fields` or `--format jsonl`: the diff needs complete records.
The command reads those two files and does not scan or run the project. Exit code 0 means the comparison finished,
including one with changes or warnings; 2 means an invalid argument, unreadable input or output, or invalid inventory.

## Matches and changes

Tests match by `id` first. Remaining tests match by `bodyHash` when exactly one old and one new test share it. When
several share a body, the diff tries a unique match by file, then file and suite path, then dependencies other than
the test's own file. It never guesses between remaining ties: they remain additions and removals. A rename plus a
body edit in the same change can therefore appear as an addition and removal. `match` records the evidence used.

`changes` contains additions, removals and changed matches, each with `kinds`, `match`, the original `before` and
`after` records, and `changedFields`. An addition has `before: null`, a removal `after: null`; both have `match: null`.
The list sorts by the current file, full name and id, using the previous record for removals.

| Kind                                 | Meaning                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `added`, `removed`                   | No matching record on the other side.                                                                                                            |
| `moved`, `renamed`                   | A matched test changed file, or changed title or suite path.                                                                                     |
| `bodyChanged`, `dependenciesChanged` | The corresponding hash changed. A rename can change `dependencyHash`, which includes the call's title.                                           |
| `newlySkipped`, `reEnabled`          | Active or expected-to-fail became skip, fixme or todo, or the reverse. Conditions remain in the records; this does not prove the condition held. |
| `stateChanged`, `tagsChanged`        | The declared state or the set of tags changed.                                                                                                   |
| `metadataChanged`                    | Other metadata changed, such as timeout, retries, focus, reasons, conditions or assertion counts.                                                |

One test can have several kinds, so category counts overlap. `summary.changed` counts matched tests with changes;
`summary.unchanged` counts matches without changes. Moving only to another line does not count as a change. Location
keys, registration ids, `declaredAt` and `stateLine` are excluded from `changedFields`, including the line numbers
inside annotations and steps. Annotation content and step titles, depth and skip state are still compared.

`clones.before` and `clones.after` group tests sharing an exact `bodyHash`, with their sorted `testIds`. Trivial bodies
such as empty callbacks share a hash too. These groups are candidates to inspect, not proof of redundant tests.

## Hash compatibility and incomplete scans

Hashes are comparable only when both scans have the exact same `tool.version`. Across versions the diff still
matches ids and compares state, tags and other metadata, but disables hash comparisons and rename matching, sets
`hashesComparable: false`, and adds a warning. Hashes are syntax-tree based; a parser update or a detection fix may
change them even in a patch. Rescan both revisions with one tool version when following history.

A scan with errors adds a warning: missing tests can look like additions or removals. An unreadable or partial scan
cannot establish that a test was deleted. Inventories from different frameworks, with duplicate test ids, or not
matching the complete schema v1 format are refused.

## Library and schema

Use `diffInventories(before, after)` and `formatDiffMarkdown(diff)` from the library. Neither mutates the inventories.
The [library reference](/guide/library#diffinventories) includes their types. The diff has its own schema, exported
as `test-inventory/schema/diff-v1.json`; `schemaVersion: 1` in a diff refers to that format, not the inventory format.

Markdown escapes titles and paths as text. To put the report in a pull request, let a workflow with write permission
post the saved report. For forks, keep scanning in an unprivileged pull-request workflow, then have a separate
`workflow_run` workflow validate its originating repository and run before reading the report as data. Never execute
code or shell text from that artifact. A sticky comment can be updated using a fixed marker and the comment id;
posting and permissions remain the workflow's responsibility.
