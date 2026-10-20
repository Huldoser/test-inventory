import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { writeInventory, writeInventoryLines } from '../src/json.ts';
import { pickTestFields, type Inventory, type InventoryLine } from '../src/index.ts';
import { EXAMPLES, readGolden } from './examples.ts';
import { PLAYWRIGHT_IMPORT, scanPlaywright, strictSchema } from './helpers.ts';

async function written(inventory: Inventory, pretty: boolean): Promise<{ text: string; chunks: number }> {
  const chunks: string[] = [];
  await writeInventory(inventory, pretty, (chunk) => {
    chunks.push(chunk);
    return Promise.resolve();
  });
  return { text: chunks.join(''), chunks: chunks.length };
}

const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { TAGS } from './tags';
test.describe('orders', () => {
  test('fills a market order', { tag: TAGS.smoke }, async () => {});
  test.skip('fills a stop order', async () => {});
});
`);

describe('writeInventory', () => {
  it.each([false, true])('writes exactly what JSON.stringify returns, pretty: %s', async (pretty) => {
    const { text } = await written(inventory, pretty);
    expect(text).toBe(JSON.stringify(inventory, null, pretty ? 2 : undefined));
  });

  it.each([false, true])('writes empty lists the same way, pretty: %s', async (pretty) => {
    const empty = scanPlaywright('');
    expect((await written(empty, pretty)).text).toBe(JSON.stringify(empty, null, pretty ? 2 : undefined));
  });

  it('writes a large inventory in several chunks', async () => {
    const titles = Array.from({ length: 400 }, (_, index) => `test('quotes symbol ${index}', async () => {});`);
    const large = scanPlaywright(`${PLAYWRIGHT_IMPORT}\n${titles.join('\n')}`);
    const { text, chunks } = await written(large, true);
    expect(text).toBe(JSON.stringify(large, null, 2));
    expect(chunks).toBeGreaterThan(1);
  });
});

async function lines(inventory: Parameters<typeof writeInventoryLines>[0]): Promise<string[]> {
  const chunks: string[] = [];
  await writeInventoryLines(inventory, (chunk) => {
    chunks.push(chunk);
    return Promise.resolve();
  });
  expect(chunks.length).toBeGreaterThan(0);
  const text = chunks.join('');
  expect(text.endsWith('\n')).toBe(true);
  return text.slice(0, -1).split('\n');
}

describe('writeInventoryLines', () => {
  const ajv = new Ajv({ allErrors: true }).addSchema(strictSchema);
  const DEFINITIONS: Record<string, string> = {
    suite: 'SuiteRecord',
    test: 'TestRecord',
    diagnostic: 'Diagnostic',
    summary: 'Summary',
  };

  it.each(EXAMPLES.map((example) => example.name))('writes every record of %s on its own line', async (name) => {
    const inventory = readGolden(name);
    const parsed = (await lines(inventory)).map((line) => JSON.parse(line) as InventoryLine);
    expect(parsed.map((line) => line.type)).toEqual([
      'inventory',
      ...inventory.suites.map(() => 'suite'),
      ...inventory.tests.map(() => 'test'),
      ...inventory.diagnostics.map(() => 'diagnostic'),
      'summary',
    ]);
    const records = (type: InventoryLine['type']) =>
      parsed
        .filter((line) => line.type === type)
        .map((line) => Object.fromEntries(Object.entries(line).filter(([key]) => key !== 'type')));
    expect({
      ...records('inventory')[0],
      summary: records('summary')[0],
      suites: records('suite'),
      tests: records('test'),
      diagnostics: records('diagnostic'),
    }).toStrictEqual(inventory);
  });

  it('writes records that match the schema once their type is taken off', async () => {
    const parsed = (await lines(readGolden('trading-web'))).map((line) => JSON.parse(line) as InventoryLine);
    for (const { type, ...record } of parsed.filter((line) => line.type !== 'inventory')) {
      const validate = ajv.getSchema(`${String(strictSchema.$id)}#/definitions/${DEFINITIONS[type]}`);
      expect(validate?.(record), type).toBe(true);
    }
  });

  it('writes test lines with only the picked keys', async () => {
    const inventory = readGolden('trading-web');
    const line = (await lines(pickTestFields(inventory, ['fullName'])))[1 + inventory.suites.length];
    expect(JSON.parse(line)).toStrictEqual({
      type: 'test',
      id: inventory.tests[0].id,
      fullName: 'price alerts > notifies when the price crosses above the alert',
    });
  });

  it('writes a large inventory in several chunks', async () => {
    const titles = Array.from({ length: 400 }, (_, index) => `test('quotes symbol ${index}', async () => {});`);
    const large = scanPlaywright(`${PLAYWRIGHT_IMPORT}\n${titles.join('\n')}`);
    const chunks: string[] = [];
    await writeInventoryLines(large, (chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('').split('\n')).toHaveLength(large.tests.length + large.suites.length + 3);
  });
});
