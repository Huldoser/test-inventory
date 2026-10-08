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
        run: jq -e '.summary.onlyCount == 0' inventory.json

      - name: List tests that don't run
        run: |
          {
            echo '### Tests that do not run'
            jq -r '.tests[] | select(.state != "active") | "- `\(.state)` \(.fullName) (\(.relativeFilePath):\(.lineStart))"' inventory.json
          } >> "$GITHUB_STEP_SUMMARY"

      - uses: actions/upload-artifact@v7
        with:
          name: test-inventory
          path: inventory.json
```

`jq` is installed on GitHub's runners. `jq -e` exits with 1 when the expression is false, which fails the step. For
the [trading-web](/guide/examples#playwright-end-to-end-tests) example, the summary step writes:

<!-- recipe: trading-web -->

::: code-group

```sh [jq]
jq -r '.tests[] | select(.state != "active") | "- `\(.state)` \(.fullName) (\(.relativeFilePath):\(.lineStart))"' inventory.json
```

:::

```text
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
      run: |
        jq -r --slurpfile base base.json '
          ($base[0].tests | map(select(.isActive) | .id)) as $active
          | .tests[] | select(.isActive | not) | select(.id as $id | $active | index($id))
          | "\(.state) \(.fullName) (\(.relativeFilePath):\(.lineStart))"' inventory.json
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
    - node -e "const { summary } = require('./inventory.json'); process.exit(summary.onlyCount > 0 ? 1: 0)"
  artifacts:
    paths:
      - inventory.json
    expire_in: 30 days
```

The `node` image has no `jq`, so the focused-test check uses Node.js.

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
    sh "jq -e '.summary.onlyCount == 0' inventory.json"
    archiveArtifacts artifacts: 'inventory.json'
  }
}
```
