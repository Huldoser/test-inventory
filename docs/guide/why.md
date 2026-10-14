---
description: What the runners' lists leave out, and what test-inventory reads from the code without a run.
---

# Why test-inventory

Playwright and Vitest can list their tests: `playwright test --list` and `vitest list`. A list says which tests exist.
It doesn't say which of them won't run, under what condition, or why. test-inventory reads the test files and answers
those questions from the code, without running anything.

## What a runner's list leaves out

This test from the [trading-web](/guide/examples#playwright-end-to-end-tests) example doesn't run on WebKit:

<!-- code: trading-web/tests/orders/limit-orders.spec.ts -->

```ts
// FIXME: TRD-412 the confirm dialog stays open on WebKit
test(
  'rejects a limit price far from the last trade',
  { annotation: { type: 'issue', description: 'TRD-412' } },
  async ({ browserName, orderTicket }) => {
    test.fixme(browserName === 'webkit', 'confirm dialog stays open on WebKit');
    await orderTicket.buy({ quantity: 1, limitPrice: 1 });
    await expect(orderTicket.error).toHaveText('Limit price is more than 50% away from the last trade.');
  },
);
```

`playwright test --list` shows it as a test expected to pass, in the WebKit project too: the `fixme` call in its body
only takes effect while the test runs. The reason and the comment with the ticket are not in the list. For a Vitest
suite, `vitest list` leaves skipped and todo tests out altogether. test-inventory reports the test like this:

<!-- output: trading-web -->

```json
{
  "fullName": "orders > limit orders > rejects a limit price far from the last trade",
  "state": "fixme",
  "isConditional": true,
  "condition": "browserName === 'webkit'",
  "reason": "confirm dialog stays open on WebKit",
  "stateLine": 28,
  "annotations": [{ "type": "issue", "description": "TRD-412", "lineStart": 26 }],
  "comments": ["FIXME: TRD-412 the confirm dialog stays open on WebKit"]
}
```

Each record also has the tags, an id that stays the same when the test moves to another line, and a hash of its body
that changes when its code does. Playwright and Vitest suites get the same keys.
[Compared with the runners](/guide/runners) has the full comparison.

## Questions it answers

Each links to a recipe that runs on a scan:

- [Tests that don't run, and why](/guide/recipes#tests-that-don-t-run-and-why): skipped, fixme, todo and
  expected-to-fail tests, with the reason given in the code.
- [Tickets mentioned by tests that don't run](/guide/recipes#tickets-mentioned-by-tests-that-don-t-run): check that
  every disabled test has one, or list the tests a ticket blocks.
- [Tests per tag](/guide/recipes#smoke-tests-per-file): the smoke tests in each file, or the tests with any other tag.
- [Focused tests](/guide/ci#github-actions): fail a CI job when a test or a describe uses `.only`.
- [Tests a pull request stopped running](/guide/ci#tests-that-stopped-running-in-a-pull-request): the scans of its base
  and its head, compared by id.
- [The state of a test in an editor or a linter](/guide/library#scansource): `scanSource` reads code that isn't saved
  to disk.

## Why from the source

- **Nothing runs.** A scan needs no browsers, no build, no environment variables and no installed runner. It takes
  seconds, so it fits any CI job that has Node.js, and it can scan a checkout of another branch, such as the base of a
  pull request.
- **Conditions stay as written.** The runner evaluates a condition such as `browserName === 'webkit'` while it runs,
  for one browser on one machine at a time. The inventory keeps the condition, so one scan covers them all.
- **The output is plain JSON.** Two scans of the same code give the same bytes, so an inventory can be kept as a build
  artifact, compared with an earlier one and read from any language.

## What it doesn't do

test-inventory reads declarations, not results. It doesn't know whether a test passed or how long it took, and it
doesn't evaluate a condition; the runner's report has those. Some things are only known at run time, such as the tests
a config file's `grep` leaves out. [Known limits](/guide/limits) lists them; most show up in the output as a
diagnostic. When all you need is the names of the tests that will run on one machine, the runner's own list is the
right tool.
