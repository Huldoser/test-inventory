import type { Inventory } from './types.ts';

/** An inventory as the command line writes it, with every key of the test records or only the picked ones. */
export type Output = Omit<Inventory, 'tests'> & { tests: object[] };

/** Collects small pieces into larger chunks, so a stream gets few writes. */
const CHUNK_SIZE = 64 * 1024;

function chunked(write: (chunk: string) => Promise<void>) {
  let buffer = '';
  return {
    emit: async (text: string) => {
      buffer += text;
      if (buffer.length >= CHUNK_SIZE) {
        await write(buffer);
        buffer = '';
      }
    },
    flush: () => write(buffer),
  };
}

/**
 * Writes an inventory as JSON one record at a time, so a large inventory never becomes one huge string.
 * The text is exactly what `JSON.stringify(inventory, null, pretty ? 2 : undefined)` returns.
 */
export async function writeInventory(
  inventory: Output,
  pretty: boolean,
  write: (chunk: string) => Promise<void>,
): Promise<void> {
  const { emit, flush } = chunked(write);
  const stringify = (value: unknown, depth: number) => {
    const json = JSON.stringify(value, null, pretty ? 2 : undefined);
    return pretty ? json.replaceAll('\n', `\n${'  '.repeat(depth)}`) : json;
  };
  const newline = (depth: number) => (pretty ? `\n${'  '.repeat(depth)}` : '');
  const entries = Object.entries(inventory);
  await emit('{');
  for (const [index, [key, value]] of entries.entries()) {
    await emit(`${index > 0 ? ',' : ''}${newline(1)}${JSON.stringify(key)}:${pretty ? ' ' : ''}`);
    if (Array.isArray(value) && value.length > 0) {
      await emit('[');
      for (const [position, item] of value.entries()) {
        await emit(`${position > 0 ? ',' : ''}${newline(2)}${stringify(item, 2)}`);
      }
      await emit(`${newline(1)}]`);
    } else {
      await emit(stringify(value, 1));
    }
  }
  await emit(`${newline(0)}}`);
  await flush();
}

/** Writes an inventory as JSON Lines: one line per record, each marked by `type`, as `InventoryLine` describes. */
export async function writeInventoryLines(inventory: Output, write: (chunk: string) => Promise<void>): Promise<void> {
  const { emit, flush } = chunked(write);
  const line = (type: string, record: object) => emit(`${JSON.stringify({ type, ...record })}\n`);
  const { schemaVersion, tool, framework, frameworkVersion } = inventory;
  await line('inventory', { schemaVersion, tool, framework, frameworkVersion });
  for (const suite of inventory.suites) await line('suite', suite);
  for (const test of inventory.tests) await line('test', test);
  for (const diagnostic of inventory.diagnostics) await line('diagnostic', diagnostic);
  await line('summary', inventory.summary);
  await flush();
}
