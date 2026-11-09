---
description: Give AI coding agents a project's tests with the test-inventory MCP server, the command line or the docs as plain text.
---

# AI agents

Coding agents ask the questions about tests that people do: which tests cover limit orders, which are skipped on
WebKit and why, whether a change left a `.only` behind, which tests a change can affect. test-inventory answers them from the source code, so an agent
gets the answer without running the suite.

## MCP server

[test-inventory-mcp](https://github.com/Huldoser/test-inventory-mcp) is a
[Model Context Protocol](https://modelcontextprotocol.io) server built on test-inventory. Agents in Claude Code,
Cursor, VS Code and other MCP clients call its tools instead of running commands. It reads the test files, runs no
code from the project, writes nothing and opens no network connections.

Those promises describe the running server. `npx` may download packages during installation, and the MCP client may
send tool answers to its model provider. Read the server's [security boundaries](https://github.com/Huldoser/test-inventory-mcp#security)
before scanning private code.

In Claude Code, from the project folder:

```sh
claude mcp add --scope project test-inventory -- npx -y test-inventory-mcp@0.9 --framework playwright
```

`--scope project` saves the server in `.mcp.json`, so everyone who works on the project gets it. It scans the test
files the project's configs run, with the runner `--framework` names: `playwright`, `vitest`, `jest`, `mocha`,
`jasmine`, `cypress`, `webdriverio`, `node` or `bun`. Without `--framework`, it uses the runner the project uses, and an
agent names one when the project has several. Globs pick the files instead, as on the [command line](/guide/cli). The
setup for Cursor and VS Code, the options and the security notes are in the server's [README](https://github.com/Huldoser/test-inventory-mcp#setup).

### Verify and try it

Open the client's MCP server list and confirm that `test-inventory` is connected. In Claude Code use `/mcp`, then ask:

> Use test-inventory to summarize this project's tests. If there are scan errors, show the diagnostics.

The agent should call `test_summary` and report counts for the intended project and framework. Next, try:

> List tests marked skip or fixme, with their conditions and reasons.

Conditional states do not prove a test was skipped in a run, and expected-to-fail tests execute. See
[key concepts](/guide/concepts) before treating these counts as execution results. If tools are missing or a path is
refused, use the server's [troubleshooting steps](https://github.com/Huldoser/test-inventory-mcp#troubleshooting).

| Tool               | Answers                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test_summary`     | Counts by state, tag and annotation, for the whole suite or for each file, tag or project, with the configs and their projects.                  |
| `find_tests`       | The tests that match states, tags, title text, changed files (`related`), projects, `.only` or a missing reason, with chosen keys.               |
| `get_tests`        | Every key of up to 20 tests by id, with the diagnostics about them; as many as fit in one answer, and the other ids in `remaining`.              |
| `scan_diagnostics` | What the scan could not read, such as a file that failed to parse.                                                                               |
| `diff_inventories` | Changes between two complete saved JSON scans: additions, removals, renames, moves, states, tags, code and dependencies, with matching evidence. |

The tests have the keys of the [output](/reference/output). Each scan-tool call reads the files again, so answers follow the
agent's edits. `related` takes the files a change touches, as `git diff --name-only` writes them, and keeps the tests
whose [`dependencies`](/reference/output#tests) include one of them, as [`--related`](/guide/cli#tests-a-change-can-affect)
does on the command line. Every scan tool also takes `expandCases`, which lists each case of a `.each` or `.for` table and
each pass of a loop as its own test, with the name the runner gives it, as `--expand-cases` does.

The server has its own versions. Before 1.0, a change that breaks its tools raises the minor version, so
`test-inventory-mcp@0.9` gets fixes only. Pass only the arguments a tool lists; unknown keys are errors.

`diff_inventories` reads saved scans instead. Pass `before` and `after`, paths inside the server's project, and
`limit` and `cursor` for pages. Save complete JSON inventories with matching roots, patterns, filters and case
expansion. Rename and hash comparisons require the same exact core version; warnings describe incomplete comparisons.
See [Compare inventories](/guide/diff).

## Command line

An agent with a shell can run the command line itself. The [filters](/guide/cli#filters) and `--fields` keep the
output to what the question needs:

<!-- scan: trading-web -->

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --state skip --state fixme --fields fullName,reason
```

A line in the project's `AGENTS.md`, or `CLAUDE.md` for Claude Code, tells agents when to use it:

```md
To find tests and their skip reasons without running them, use
`npx test-inventory "tests/**/*.spec.ts" --framework playwright` with `--state`, `--tag`, `--grep` and `--fields`.
To find the tests a change can affect, pass the changed files with `--related`.
Options: https://huldoser.github.io/test-inventory/guide/cli
```

## Docs as plain text

The docs are also published for agents to read:
[`llms.txt`](https://huldoser.github.io/test-inventory/llms.txt) lists the pages,
[`llms-full.txt`](https://huldoser.github.io/test-inventory/llms-full.txt) has all of them in one file, and each page
is available as Markdown at its address with `.md` added, such as
[`/guide/cli.md`](https://huldoser.github.io/test-inventory/guide/cli.md).
