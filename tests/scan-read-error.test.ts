import type * as FsPromises from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { scan } from '../src/index.ts';
import { PLAYWRIGHT_PACKAGE, project } from './project.ts';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  return {
    ...original,
    readFile: vi.fn(async (file: string, encoding: BufferEncoding) => {
      if (file.endsWith('locked.spec.ts'))
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      // A thrown value need not be an Error; the scan reports both kinds.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (file.endsWith('odd.spec.ts')) throw 42;
      if (file.endsWith('disk.spec.ts')) throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
      return original.readFile(file, encoding);
    }),
  };
});

describe('scan', () => {
  it('reports a file it cannot read and goes on with the others', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/locked.spec.ts': '',
      'tests/odd.spec.ts': '',
      'tests/disk.spec.ts': '',
      'tests/orders.spec.ts': "import { test } from '@playwright/test';\ntest('fills', async () => {});\n",
    });
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(
      inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.relativeFilePath, diagnostic.message]),
    ).toEqual([
      ['read-error', 'tests/disk.spec.ts', 'The file could not be read: error (EIO).'],
      ['read-error', 'tests/locked.spec.ts', 'The file could not be read: permission denied (EACCES).'],
      ['read-error', 'tests/odd.spec.ts', 'The file could not be read: unknown error.'],
    ]);
    expect(inventory.summary).toMatchObject({ fileCount: 4, testCount: 1 });
  });
});
