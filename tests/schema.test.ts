import { readFileSync } from 'node:fs';
import { Ajv, type SchemaObject } from 'ajv';
import { describe, expect, it } from 'vitest';
import { generateSchema, schemaPath } from '../scripts/schema.ts';
import { PLAYWRIGHT_IMPORT, scanPlaywright, schema, strictSchema } from './helpers.ts';

const validate = new Ajv({ allErrors: true }).compile(schema);
const validateStrict = new Ajv({ allErrors: true }).compile(strictSchema);

const output = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { TAGS } from './tags';
test.describe('orders', { tag: '@orders' }, () => {
  test('cancels an open limit order', { tag: TAGS.risk }, async () => {});
  test.fixme('rejects an order above buying power', async ({ browserName }) => {});
});
`);

/** A copy of the scan output with one value changed, in shapes the types don't allow. */
function edited(path: (string | number)[], value: unknown): unknown {
  const copy = structuredClone(output) as unknown as Record<string | number, unknown>;
  const key = path[path.length - 1];
  let target = copy;
  for (const step of path.slice(0, -1)) target = target[step] as Record<string | number, unknown>;
  target[key] = value;
  return copy;
}

describe('schema/v1.json', () => {
  it('is generated from the current src/types.ts (run npm run schema)', () => {
    expect(readFileSync(schemaPath, 'utf8')).toBe(generateSchema());
  });

  it('accepts scan output, with no keys outside the schema', () => {
    validateStrict(output);
    expect(validateStrict.errors).toBeNull();
  });

  it('requires every key of every object', () => {
    for (const definition of Object.values(schema.definitions as Record<string, SchemaObject>)) {
      if (definition.properties) expect(definition.required).toEqual(Object.keys(definition.properties as object));
    }
  });

  it('accepts a key it does not know, so readers of v1 keep working when keys are added', () => {
    const withNewKey = edited(['tests', 0, 'retries'], 2);
    expect(validate(withNewKey)).toBe(true);
    expect(validateStrict(withNewKey)).toBe(false);
  });

  it.each([
    ['state', ['tests', 1, 'state'], 'flaky'],
    ['diagnostic code', ['diagnostics', 0, 'code'], 'unresolved-constant'],
    ['state source', ['tests', 1, 'stateSource'], 'project'],
    ['framework', ['framework'], 'jest'],
  ])('accepts a %s it does not know, as the set is open, and the strict copy rejects it', (_, path, value) => {
    expect(validate(edited(path, value))).toBe(true);
    expect(validateStrict(edited(path, value))).toBe(false);
  });

  it.each([
    ['a number as the state', ['tests', 1, 'state'], 3],
    ['a test without bodyHash', ['tests', 0, 'bodyHash'], undefined],
    ['an id in upper case', ['tests', 0, 'id'], 'FCA65859363F6383'],
    ['a suite id one character short', ['tests', 0, 'suiteId'], 'aa04cf305abe56d'],
    ['a 0-based column', ['tests', 0, 'columnStart'], 0],
    ['a fractional count', ['summary', 'testCount'], 2.5],
    ['null instead of an empty tag list', ['suites', 0, 'tags'], null],
    ['schemaVersion 2', ['schemaVersion'], 2],
  ])('rejects %s', (_, path, value) => {
    expect(validate(edited(path, value))).toBe(false);
  });
});
