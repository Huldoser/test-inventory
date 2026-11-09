---
layout: home

hero:
  name: test-inventory
  text: Test metadata from source code, not from test results.
  tagline: Find tests, their skip reasons and the tests a change can affect. Read the source code without running the suite.
  image:
    light: /mark-light.svg
    dark: /mark-dark.svg
    alt: test-inventory
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why test-inventory
      link: /guide/why
    - theme: alt
      text: Output reference
      link: /reference/output
---

## What you get

Scan Playwright, Vitest, Jest, Mocha, Jasmine, Cypress, WebdriverIO, node:test and Bun suites into a shared JSON format.
Each test has its title, location, suite, tags and declared state, with reasons and conditions where available.

Ids survive moves to another line. Hashes track code and supported dependencies, so you can compare saved scans and
find tests that may be affected by a change. The inventory describes source declarations, not pass/fail results.

```sh
npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
```

## Choose your starting point

- **Use the CLI:** [scan an existing project](/guide/getting-started), then try the [query recipes](/guide/recipes).
- **Use the library:** call [scan or scanSource](/guide/library) from an application or editor.
- **Use an AI agent:** [connect the MCP server](/guide/agents) to your client.
- **Review a change:** [compare saved inventories](/guide/diff) or add a [CI report](/guide/ci).

Read [key concepts](/guide/concepts) before interpreting counts and states. If the result is unexpected, start with
[troubleshooting](/guide/troubleshooting); the [output reference](/reference/output) describes every key.

## Support

If test-inventory is useful to you, [star it on GitHub](https://github.com/Huldoser/test-inventory) or
[sponsor its development](https://github.com/sponsors/Huldoser). Stars help other teams find it, and sponsorship pays
for the time that goes into new framework versions and fixes.
