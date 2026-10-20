---
description: The scan and scanSource functions, filterInventory and pickTestFields, the inventory they return and the JSON Schema of the output.
---

# Library

The package also exports the functions the command line uses. It is ESM only.

```ts
import { filterInventory, pickTestFields, scan, scanSource, type Inventory } from 'test-inventory';
```

## scan

Scans the files that match the patterns and returns the inventory. The options are the same as on the
[command line](/guide/cli), in camel case.

<!-- types: scan, ScanOptions, Framework, CommentsMode -->

To count the tests that are always skipped in the web app:

```ts
const inventory = await scan({
  patterns: ['tests/**/*.spec.ts'],
  framework: 'playwright',
  root: 'apps/trading-web',
  ignore: ['tests/legacy/**'],
});

const skipped = inventory.tests.filter((test) => test.isSkipped && !test.isConditional);
console.log(`${skipped.length} tests are always skipped`);
```

## scanSource

Scans the code of one file without reading anything from disk. Use it in editors, linters or tests.

<!-- types: scanSource, ScanSourceOptions -->

To read the state of a test from code that is not on disk:

```ts
const inventory = scanSource({
  code: "import { test } from 'vitest';\ntest.todo('charges the daily borrow fee');",
  relativeFilePath: 'tests/orders/short-selling.test.ts',
  framework: 'vitest',
  frameworkVersion: '5.0.3',
});
inventory.tests[0].state; // 'todo'
```

Because it reads no files, `scanSource` cannot follow a custom `test` object imported from a fixtures file. Tests
that use one are reported with an `unresolved-test-import` diagnostic; `scan` follows the import.

## filterInventory

Keeps the tests that pass a filter, as the [filter options](/guide/cli#filters) on the command line do. The result is
an inventory of those tests, which still matches the JSON Schema.

<!-- types: filterInventory, InventoryFilter -->

To list the smoke tests that are marked fixme, with their files:

```ts
const inventory = await scan({ patterns: ['tests/**/*.spec.ts'], framework: 'playwright' });
const fixme = filterInventory(inventory, { states: ['fixme'], tags: ['@smoke'] });

for (const test of fixme.tests) console.log(`${test.relativeFilePath}:${test.lineStart} ${test.fullName}`);
```

## pickTestFields

Keeps only `id` and the given keys on each test, as `--fields` does, to make the output smaller. TypeScript knows
which keys are left.

<!-- types: pickTestFields, PickedInventory -->

```ts
const short = pickTestFields(fixme, ['fullName', 'reason']);
short.tests[0].reason; // string | null
```

## Inventory

Both scan functions return an inventory, the object the command line writes as JSON. The
[output reference](/reference/output) describes each of its records key by key.

<!-- types: Inventory, Tool -->

## Errors

Every function throws a `TypeError` that names the option when an option is invalid. Anything about the scanned code
or files becomes a [diagnostic](/reference/diagnostics) in the result.

## JSON Schema

The output's JSON Schema ships with the package, under the `schemaVersion` it describes, so a reader can pin the
version of the format it understands:

```ts
import schema from 'test-inventory/schema/v1.json' with { type: 'json' };
```

It is also published at [huldoser.github.io/test-inventory/schema/v1.json](https://huldoser.github.io/test-inventory/schema/v1.json),
the URL in its `$id`.
