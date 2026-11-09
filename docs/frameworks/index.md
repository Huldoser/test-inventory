---
description: Choose a test runner for a focused scan walkthrough, supported syntax and relevant limitations.
prev: false
next: false
---

# Choose your framework

Each guide takes you from installation to a first scan, explains its output and covers the settings and limits
specific to that runner. All guides use the same inventory format and share the general scanner rules.

| Runner                                 | Guide covers                                                              |
| -------------------------------------- | ------------------------------------------------------------------------- |
| [Playwright](/frameworks/playwright)   | Fixtures, conditional skips, tags and generated BDD files.                |
| [Vitest](/frameworks/vitest)           | Services, component tests, in-source tests, tables and mocks.             |
| [Jest](/frameworks/jest)               | Services, presets, globals and Puppeteer.                                 |
| [Mocha](/frameworks/mocha)             | BDD and TDD interfaces, configuration and Puppeteer.                      |
| [Jasmine](/frameworks/jasmine)         | Specs, helpers, disabled tests and pending states.                        |
| [Cypress](/frameworks/cypress)         | End-to-end and component selection, support files and browser conditions. |
| [WebdriverIO](/frameworks/webdriverio) | Mocha or Jasmine specs, capabilities and worker counts.                   |
| [node:test](/frameworks/node)          | Node.js test scripts, subtests and the `--framework node` option.         |
| [Bun](/frameworks/bun)                 | Bun test files, `bunfig.toml`, tables and focused tests.                  |

## Projects with two or more runners

Open a guide for each runner; choosing one does not hide the others or change another browser tab.
In each scan, pass `--framework` and globs for that runner's files. Run separate scans and give the outputs distinct
names so one does not replace the other. For example, in a project with Vitest unit tests in `src/` and
Playwright tests in `e2e/`:

```sh
npx test-inventory "src/**/*.test.ts" --framework vitest --output inventory-vitest.json
npx test-inventory "e2e/**/*.spec.ts" --framework playwright --output inventory-playwright.json
```

These paths are examples; use your project's layout. Every scan produces the same schema, with a `framework`
identifying the runner. Selecting a documentation guide does not configure the scanner.

## Shared references

- [Getting started](/guide/getting-started): requirements and common commands.
- [Key concepts](/guide/concepts) and [shared limits](/guide/limits): what a static scan can tell you.
- [All examples](/guide/examples), [all supported syntax](/reference/syntax) and [runner comparison](/guide/runners).
- [CLI](/guide/cli), [library](/guide/library), [MCP](/guide/agents), [output](/reference/output) and [diagnostics](/reference/diagnostics).
