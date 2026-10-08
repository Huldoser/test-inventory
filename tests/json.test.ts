import { describe, expect, it } from 'vitest';
import { writeInventory } from '../src/json.ts';
import type { Inventory } from '../src/index.ts';
import { PLAYWRIGHT_IMPORT, scanPlaywright } from './helpers.ts';

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
