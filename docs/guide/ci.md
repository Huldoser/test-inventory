# CI recipes

A scan takes seconds and needs no browsers and no build, so it fits in any job that has Node.js. These recipes keep
the inventory as a build artifact, list the tests that don't run in the job summary, block focused tests, and find
tests that stopped running in a pull request.

The examples scan a Playwright suite. For Vitest, change the globs and `--framework vitest`.

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

      - name: List tests that don't run
        run: node scripts/not-running.mjs >> "$GITHUB_STEP_SUMMARY"

      - uses: actions/upload-artifact@v7
        with:
          name: test-inventory
          path: inventory.json
```

The focused-test check exits with 1 when a test or a describe uses `.only`, which fails the step. The summary step
runs a script kept in the repository, so it can be read, linted and run locally like any other code:

<!-- recipe: trading-web -->

```js
// scripts/not-running.mjs
import { readFileSync } from 'node:fs';

const { tests } = JSON.parse(readFileSync('inventory.json', 'utf8'));
console.log('### Tests that do not run');
for (const test of tests.filter((test) => test.state !== 'active')) {
  console.log(`- \`${test.state}\` ${test.fullName} (${test.relativeFilePath}:${test.lineStart})`);
}
```

For the [trading-web](/guide/examples#playwright-end-to-end-tests) example, it writes:

```text
### Tests that do not run
- `skip` price alerts > notifies when the price crosses above the alert (tests/alerts.spec.ts:11)
- `skip` price alerts > does not notify for a price that was never reached (tests/alerts.spec.ts:16)
- `skip` price alerts > deletes an alert (tests/alerts.spec.ts:21)
- `expectedToFail` backtests > exports trades to CSV (tests/backtest.spec.ts:20)
- `fixme` login > asks for a one-time code on a new device (tests/login.spec.ts:25)
- `fixme` orders > limit orders > rejects a limit price far from the last trade (tests/orders/limit-orders.spec.ts:24)
- `fixme` live price stream > updates prices without a reload (tests/price-stream.spec.ts:6)
- `fixme` live price stream > shows a stale badge when the stream disconnects (tests/price-stream.spec.ts:12)
```

## Tests that stopped running in a pull request

A test's `id` does not change when the test moves to another line, so two scans can be compared by id. This job
scans the pull request's base in a second worktree and lists the tests that ran there and don't run any more:

```yaml
# Another job in the workflow above, under jobs:
stopped-running:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v7
      with:
        fetch-depth: 0
    - uses: actions/setup-node@v7
      with:
        node-version: 24
        cache: npm
    - run: npm ci
    - run: git worktree add ../base "origin/${{ github.base_ref }}"
    - run: npx test-inventory "tests/**/*.spec.ts" --framework playwright --root ../base --output base.json
    - run: npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
    - name: List tests that stopped running
      run: node scripts/stopped-running.mjs base.json inventory.json
```

```js
// scripts/stopped-running.mjs
import { readFileSync } from 'node:fs';

const [base, head] = process.argv.slice(2).map((file) => JSON.parse(readFileSync(file, 'utf8')));
const active = new Set(base.tests.filter((test) => test.isActive).map((test) => test.id));
for (const test of head.tests.filter((test) => !test.isActive && active.has(test.id))) {
  console.log(`${test.state} ${test.fullName} (${test.relativeFilePath}:${test.lineStart})`);
}
```

A renamed test gets a new id, so it shows up as removed and added rather than as stopped.

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

```yaml
- script: npx test-inventory "tests/**/*.spec.ts" --framework playwright --output $(Build.ArtifactStagingDirectory)/inventory.json
  displayName: Scan the tests
- publish: $(Build.ArtifactStagingDirectory)/inventory.json
  artifact: test-inventory
```

## Jenkins

```groovy
stage('Test inventory') {
  steps {
    sh 'npx test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json'
    sh '''node -e "if (require('./inventory.json').summary.onlyCount > 0) process.exit(1)"'''
    archiveArtifacts artifacts: 'inventory.json'
  }
}
```

---

If test-inventory runs in your pipeline, [sponsoring it](https://github.com/sponsors/Huldoser) helps keep it working
with each new Playwright and Vitest release.
