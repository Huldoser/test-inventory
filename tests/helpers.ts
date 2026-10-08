import { readFileSync } from 'node:fs';
import { Ajv, type SchemaObject } from 'ajv';
import { expect } from 'vitest';
import { schemaPath } from '../scripts/schema.ts';
import { scanSource, type Inventory, type ScanSourceOptions, type TestRecord } from '../src/index.ts';

export const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as SchemaObject;

/**
 * The published schema lets readers ignore new keys and accept new values of open sets; our own output must not carry
 * keys the schema doesn't list, nor values it doesn't know.
 */
export const strictSchema = JSON.parse(JSON.stringify(schema), (_key, value: unknown) => {
  if (value === null || typeof value !== 'object') return value;
  if ('properties' in value) return { ...value, additionalProperties: false };
  const known =
    'anyOf' in value && Array.isArray(value.anyOf) ? value.anyOf.find((item: object) => 'enum' in item) : null;
  return known ?? value;
}) as SchemaObject;

const validateStrict = new Ajv({ allErrors: true }).compile(strictSchema);

export function expectValidInventory(inventory: unknown): void {
  validateStrict(inventory);
  expect(validateStrict.errors ?? []).toEqual([]);
}

type Options = Partial<Omit<ScanSourceOptions, 'code' | 'framework'>>;

function scan(code: string, framework: 'playwright' | 'vitest', options: Options): Inventory {
  const inventory = scanSource({
    code,
    framework,
    relativeFilePath: framework === 'playwright' ? 'tests/orders.spec.ts' : 'tests/orders.test.ts',
    ...options,
  });
  expectValidInventory(inventory);
  return inventory;
}

export function scanPlaywright(code: string, options: Options = {}): Inventory {
  return scan(code, 'playwright', options);
}

export function scanVitest(code: string, options: Options = {}): Inventory {
  return scan(code, 'vitest', options);
}

export function titles(inventory: Inventory): string[] {
  return inventory.tests.map((test) => test.title);
}

export function codes(inventory: Inventory): string[] {
  return inventory.diagnostics.map((diagnostic) => diagnostic.code);
}

/** The only test in an inventory. */
export function onlyTest(inventory: Inventory): TestRecord {
  expect(inventory.tests).toHaveLength(1);
  return inventory.tests[0];
}

export function testNamed(inventory: Inventory, title: string): TestRecord {
  const test = inventory.tests.find((item) => item.title === title);
  if (!test) throw new Error(`No test titled ${JSON.stringify(title)} in ${JSON.stringify(titles(inventory))}`);
  return test;
}

export const PLAYWRIGHT_IMPORT = "import { test, expect } from '@playwright/test';";
export const VITEST_IMPORT = "import { describe, expect, it, test } from 'vitest';";
