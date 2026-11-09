---
description: Match documented features to core, MCP and schema versions, with concise guidance for upgrading clients.
---

# Versions and compatibility

Three versions describe different contracts:

- **Core package:** the CLI, library and scanner behavior. Inventory `tool.version` records it.
- **MCP package:** tool names, arguments, paging and answers. It depends on a compatible core version.
- **Schema:** the inventory or diff format, each with its own JSON Schema. A diff's `schemaVersion: 1` is not the
  inventory's schema format.

The site's version label identifies the core package used to build these pages. The MCP README pins its own minor
release in setup commands. Before 1.0, breaking changes use a new minor release; a pin such as `test-inventory-mcp@0.9`
accepts patch fixes within that minor.

## Feature minimums

| Feature                                                          | Core minimum       | MCP minimum |
| ---------------------------------------------------------------- | ------------------ | ----------- |
| State/tag/title filters and selected fields                      | 0.3.0              | 0.1.0       |
| Config-driven file selection                                     | 0.5.0              | 0.3.0       |
| Dependency metadata and related-file queries                     | 0.6.0              | 0.4.0       |
| Expanded table cases and loops                                   | 0.7.0              | 0.5.0       |
| Jest scanning                                                    | 0.8.0              | 0.6.0       |
| Mocha, Jasmine, Cypress, WebdriverIO, node:test and Bun scanning | 0.9.0              | 0.7.0       |
| Saved inventory diffs                                            | 0.10.0             | 0.8.0       |
| Rejecting unknown MCP arguments                                  | Not a core feature | 0.9.0       |

These are introduction versions, not recommendations to install old releases. Later fixes improve correctness within
each feature. See the [core changelog](/changelog) and [MCP changelog](https://github.com/Huldoser/test-inventory-mcp/blob/main/CHANGELOG.md)
for patch details. Runner minimums and versions actually exercised in CI are listed separately in
[getting started](/guide/getting-started#supported-runners) and [runner comparisons](/guide/runners#checked-in-ci).

## Upgrading an MCP client

From MCP 0.9, unknown keys are errors instead of silently ignored filters. Pass `states`, not `state`, and use only
arguments declared by that tool. Update the client's configured package minor when adopting a breaking release,
restart the server through the client and verify the tools again. Do not clear caches or change credentials as a
first response to an argument error.

When ids were obtained with `expandCases`, pass the same setting to `get_tests`. Keep directory, framework and
patterns the same too. The [generated reference](https://github.com/Huldoser/test-inventory-mcp/blob/main/docs/tools.md)
shows valid calls and corrective errors for the current server.

## Comparing inventories across upgrades

Use one exact core version to rescan both revisions. A new parser or scanner fix may change hashes in a patch release.
Across core versions, the diff can still compare ids and metadata but disables hash comparisons and rename matching.
Do not reuse old hashes as stable history keys across upgrades.

Readers should tolerate new keys and unknown values in the output's open sets. Removing or changing existing keys
requires a new schema version; [output versioning](/reference/output#versioning) describes that contract.
