---
description: Save an inventory in CI, block focused tests, and review newly declared skip states in pull requests.
---

# CI recipes

A scan needs no browsers or build. These recipes save the inventory as a build artifact, report declared skip
states, block focused tests and compare a pull request with its base. Install test-inventory as a dev dependency
and commit the lockfile first, so `npm ci` uses a reproducible version.

The examples scan a Playwright suite. For Vitest, Jest, Mocha, Jasmine, Cypress, WebdriverIO, node:test or Bun, change
the globs and `--framework`.

## GitHub Actions

```yaml
# .github/workflows/test-inventory.yml
name: Test inventory

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  inventory:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json

      - name: Fail on focused tests
        run: node -e "if (require('./inventory.json').summary.onlyCount > 0) process.exit(1)"

      - name: Fail on scan errors
        run: node -e "if (require('./inventory.json').diagnostics.some(d => d.level === 'error')) process.exit(1)"

      - name: List declared skip states
        run: node scripts/skip-states.mjs

      - uses: actions/upload-artifact@v7
        with:
          name: test-inventory
          path: inventory.json
```

The focused-test check fails the step when a test or describe uses `.only`. The next check refuses an inventory
with scan errors; diagnostics do not change the scanner's exit code by themselves.

The report step runs a script kept in the repository. It writes plain text to the job log, with conditions, rather
than treating source-derived titles as Markdown:

<!-- recipe: trading-web -->

```js
// scripts/skip-states.mjs
import { readFileSync } from 'node:fs';

const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
console.log('Tests marked skip, fixme or todo');
for (const test of tests.filter((test) => ['skip', 'fixme', 'todo'].includes(test.state))) {
  const condition = test.isConditional ? ` [when ${test.condition}]` : '';
  console.log(`${test.state} ${test.fullName} (${test.relativeFilePath}:${test.lineStart})${condition}`);
}
```

For the [trading-web](/guide/examples#playwright-end-to-end-tests) example, it writes:

```text
Tests marked skip, fixme or todo
skip price alerts > notifies when the price crosses above the alert (tests/alerts.spec.ts:11) [when isMarketClosed()]
skip price alerts > does not notify for a price that was never reached (tests/alerts.spec.ts:16) [when isMarketClosed()]
skip price alerts > deletes an alert (tests/alerts.spec.ts:21) [when isMarketClosed()]
fixme login > asks for a one-time code on a new device (tests/login.spec.ts:25)
fixme orders > limit orders > rejects a limit price far from the last trade (tests/orders/limit-orders.spec.ts:24) [when browserName === 'webkit']
fixme live price stream > updates prices without a reload (tests/price-stream.spec.ts:8) [when browserName === 'webkit']
fixme live price stream > shows a stale badge when the stream disconnects (tests/price-stream.spec.ts:14) [when browserName === 'webkit']
```

## Review newly declared skip states in a pull request {#tests-that-stopped-running-in-a-pull-request}

Scan the pull request's exact base and head revisions with the same installed tool, then compare the complete
inventories. The diff follows renamed and moved tests when its matching evidence allows it. `newlySkipped` means
an active or expected-to-fail test became skip, fixme or todo; it does not prove that a conditional state held in CI.

```yaml
# Another job in the workflow above, under jobs:
inventory-diff:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v7
      with:
        fetch-depth: 0
        ref: ${{ github.event.pull_request.head.sha }}
    - uses: actions/setup-node@v7
      with:
        node-version: 24
        cache: npm
    - run: npm ci
    - name: Check out the base revision
      env:
        BASE_SHA: ${{ github.event.pull_request.base.sha }}
      run: git worktree add --detach ../base "$BASE_SHA"
    - run: npx test-inventory "tests/**/*.spec.ts" --framework playwright --root ../base --output base.json
    - run: npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
    - name: Summarize inventory changes
      run: npx test-inventory diff base.json inventory.json --format markdown >> "$GITHUB_STEP_SUMMARY"
```

The job summary contains additions, removals and other changes as well as newly skipped and re-enabled tests.
The formatter escapes titles and paths as Markdown text. Read its warnings: incomplete scans cannot establish that
a test was removed. Exit code 0 means comparison completed, not that there were no changes or warnings.
Use [diffInventories](/guide/library#diffinventories) to enforce a policy on selected categories.

These examples use major action tags for readability. For a production workflow, pin actions to verified full commit
SHAs or follow your repository's [workflow dependency lockfile policy](https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles). Keep pull-request scans unprivileged; do not run
fork code in a privileged `pull_request_target` job. The [diff guide](/guide/diff#library-and-schema) covers posting
reports from a separate workflow.

## GitLab CI

```yaml
# .gitlab-ci.yml
test-inventory:
  stage: test
  image: node:24
  script:
    - npm ci
    - npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
    - node -e "if (require('./inventory.json').summary.onlyCount > 0) process.exit(1)"
  artifacts:
    paths:
      - inventory.json
    expire_in: 30 days
```

## Azure Pipelines

These steps assume Node.js is available and `npm ci` has already installed the locked dependencies:

```yaml
- script: npx test-inventory "tests/**/*.spec.ts" --framework playwright --output $(Build.ArtifactStagingDirectory)/inventory.json
  displayName: Scan the tests
- publish: $(Build.ArtifactStagingDirectory)/inventory.json
  artifact: test-inventory
```

## Jenkins

This stage also assumes Node.js and the locked dependencies are already installed:

```groovy
stage('Test inventory') {
  steps {
    sh 'npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json'
    sh '''node -e "if (require('./inventory.json').summary.onlyCount > 0) process.exit(1)"'''
    archiveArtifacts artifacts: 'inventory.json'
  }
}
```
