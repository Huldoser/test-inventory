---
layout: home

hero:
  name: test-inventory
  text: Know what your tests do, without running them.
  tagline: Audit skipped tests, catch pull requests that weaken suites, and find tests affected by a diff across 9 JS/TS runners.
  image:
    light: /mark-light.svg
    dark: /mark-dark.svg
    alt: test-inventory
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: GitHub Action
      link: /guide/ci#comment-on-pull-requests
    - theme: alt
      text: AI agents (MCP)
      link: /guide/agents

features:
  - title: CLI and JSON output
    details: Scan Playwright, Vitest, Jest, Mocha, Jasmine, Cypress, WebdriverIO, node:test and Bun suites without browsers or a build. Filter by state, tag or changed files.
    link: /guide/getting-started
    linkText: Run your first scan
  - title: Pull request review comments
    details: test-inventory-action comments on PRs when tests won't run, get skipped, are removed or lose assertions. Works on forks and never fails a check.
    link: /guide/ci#comment-on-pull-requests
    linkText: Set up the Action
  - title: MCP server for coding agents
    details: Connect test-inventory-mcp to Claude Code, Cursor or VS Code so agents inspect tests, skip reasons and run commands for a diff directly.
    link: /guide/agents
    linkText: Connect an AI client
  - title: Diffs, stable ids and run commands
    details: Track test changes across commits with stable ids and code hashes, or pipe git diff into --related --format commands to run affected tests.
    link: /guide/diff
    linkText: Compare inventories
---

## Try it in 5 seconds

No install needed (requires Node.js 22.12+). Run from your project folder to list skipped and fixme tests with their conditions and reasons:

```sh
npx test-inventory --state skip --state fixme --fields fullName,state,condition,reason --pretty
```

Or print the exact runner command for tests affected by your current branch:

```sh
git diff --name-only origin/main... | npx test-inventory --related - --format commands
```

```text
npx playwright test tests/orders/limit-orders.spec.ts tests/orders/market-orders.spec.ts tests/orders/order-lifecycle.spec.ts tests/portfolio.spec.ts --config playwright.config.ts --project chromium webkit
```

## Checked against real runners and suites

CI compares scan output against all 9 runners across supported versions ([runner comparisons](/guide/runners)) and scans 24 public repositories totaling 69,127 tests across 7,095 files on every pull request with zero parse errors ([real projects](/guide/real-projects)).

## Choose your starting point

- **Pick your runner:** [framework guides](/frameworks/) for commands, real examples, syntax and limits.
- **Query a suite:** [query recipes](/guide/recipes) and [one task, three interfaces](/guide/workflows).
- **Use the library:** call [scan, scanSource, runCommands or diffInventories](/guide/library) from TypeScript or Node.js.
- **Understand the output:** [key concepts](/guide/concepts), [output reference](/reference/output) and [troubleshooting](/guide/troubleshooting).

## Support

If test-inventory is useful to you, [star it on GitHub](https://github.com/Huldoser/test-inventory) or
[sponsor its development](https://github.com/sponsors/Huldoser). Stars help other teams find it, and sponsorship pays
for the time that goes into new framework versions and fixes.
