---
description: Give AI coding agents a project's tests with the test-inventory MCP server, the command line or the docs as plain text.
---

# AI agents

Coding agents ask the questions about tests that people do: which tests cover limit orders, which are skipped on
WebKit and why, whether a change left a `.only` behind. test-inventory answers them from the source code, so an agent
gets the answer without running the suite.

## MCP server

[test-inventory-mcp](https://github.com/Huldoser/test-inventory-mcp) is a
[Model Context Protocol](https://modelcontextprotocol.io) server built on test-inventory. Agents in Claude Code,
Cursor, VS Code and other MCP clients call its tools instead of running commands. It reads the test files, runs no
code from the project, writes nothing and opens no network connections.

In Claude Code, from the project folder:

```sh
claude mcp add --scope project test-inventory -- npx -y test-inventory-mcp@0.1 "tests/**/*.spec.ts" --framework playwright
```

`--scope project` saves the server in `.mcp.json`, so everyone who works on the project gets it. The globs and
`--framework` are the ones you would give the [command line](/guide/cli). The setup for Cursor and VS Code, the
options and the security notes are in the server's [README](https://github.com/Huldoser/test-inventory-mcp#setup).

| Tool               | Answers                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `test_summary`     | Counts by state, tag and annotation, for the whole suite or for each file or tag.             |
| `find_tests`       | The tests that match states, tags, title text, `.only` or a missing reason, with chosen keys. |
| `get_tests`        | Every key of up to 20 tests by id, with the diagnostics about them.                           |
| `scan_diagnostics` | What the scan could not read, such as a file that failed to parse.                            |

The tests have the keys of the [output](/reference/output). Each call scans the files again, so answers follow the
agent's edits.

The server has its own versions. Before 1.0, a change that breaks its tools raises the minor version, so
`test-inventory-mcp@0.1` gets fixes only.

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
Options: https://huldoser.github.io/test-inventory/guide/cli
```

## Docs as plain text

The docs are also published for agents to read:
[`llms.txt`](https://huldoser.github.io/test-inventory/llms.txt) lists the pages,
[`llms-full.txt`](https://huldoser.github.io/test-inventory/llms-full.txt) has all of them in one file, and each page
is available as Markdown at its address with `.md` added, such as
[`/guide/cli.md`](https://huldoser.github.io/test-inventory/guide/cli.md).
