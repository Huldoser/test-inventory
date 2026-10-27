import type * as Fs from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { scan } from '../src/index.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

// Reading a locked file or folder fails as it does without read permission. chmod can't take that permission away on
// Windows or from root, so the error is made here, the same on every system.
const { locked, denied } = await vi.hoisted(async () => {
  const { default: path } = await import('node:path');
  const locked = new Set<string>();
  const denied = (target: unknown) =>
    typeof target === 'string' && locked.has(path.resolve(target))
      ? Object.assign(new Error(`EACCES: permission denied, open '${target}'`), { code: 'EACCES' })
      : null;
  return { locked, denied };
});

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof Fs>();
  const throwing =
    (read: (target: string, ...rest: never[]) => unknown) =>
    (target: string, ...rest: never[]) => {
      const error = denied(target);
      if (error) throw error;
      return read(target, ...rest);
    };
  return {
    ...original,
    readFileSync: throwing(original.readFileSync),
    readdirSync: throwing(original.readdirSync),
    // The scan reads folders only through the glob, which passes options and a callback.
    readdir: (folder: string, options: object, callback: (error: Error | null) => void) => {
      const error = denied(folder);
      if (error) setImmediate(callback, error);
      else original.readdir(folder, options as never, callback as never);
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  return {
    ...original,
    readFile: vi.fn(async (file: string, encoding: BufferEncoding) => {
      const error = denied(file);
      if (error) throw error;
      // A thrown value need not be an Error; the scan reports both kinds.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (file.endsWith('odd.spec.ts')) throw 42;
      if (file.endsWith('disk.spec.ts')) throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
      return original.readFile(file, encoding);
    }),
  };
});

/** Takes read permission away from files and folders of the project until the test finishes. */
function lock(root: string, ...files: string[]): void {
  for (const file of files) locked.add(path.resolve(root, file));
  onTestFinished(() => {
    locked.clear();
  });
}

const SPEC = "import { test } from '@playwright/test';\ntest('fills an order', async () => {});\n";

describe('scan', () => {
  it('reports a file it cannot read without its absolute path, and goes on with the others', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/locked.spec.ts': SPEC,
      'tests/odd.spec.ts': '',
      'tests/disk.spec.ts': '',
      'tests/orders.spec.ts': SPEC,
    });
    lock(root, 'tests/locked.spec.ts');
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(
      inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.relativeFilePath, diagnostic.message]),
    ).toEqual([
      ['read-error', 'tests/disk.spec.ts', 'The file could not be read: error (EIO).'],
      ['read-error', 'tests/locked.spec.ts', 'The file could not be read: permission denied (EACCES).'],
      ['read-error', 'tests/odd.spec.ts', 'The file could not be read: unknown error.'],
    ]);
    expect(inventory.summary).toMatchObject({ fileCount: 4, testCount: 1 });
    expect(JSON.stringify(inventory)).not.toContain(root);
  });

  it('goes on without a lockfile, config, tsconfig, fixtures file or folder it may not read, taking globals to be on', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'pnpm-lock.yaml': "packages:\n\n  'vitest@5.0.3':\n    resolution: {}\n",
      'vitest.config.ts': 'export default { test: { globals: true } };\n',
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
      'fixtures/index.ts': "import { test as base } from 'vitest';\nexport const test = base.extend({});\n",
      'tests/fees.test.ts': "describe('fees', () => {\n  it('charges the minimum', () => {});\n});\n",
      'tests/orders.test.ts': "import { test } from '../fixtures';\ntest('fills an order', () => {});\n",
      'tests/quotes.test.ts': "import { test } from '@/fixtures';\ntest('streams quotes', () => {});\n",
      'tests/tsconfig.json': '{ "compilerOptions": { "types": ["vitest/globals"] } }',
    });
    lock(root, '.', 'pnpm-lock.yaml', 'vitest.config.ts', 'tsconfig.json', 'fixtures/index.ts', 'tests/tsconfig.json');
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.frameworkVersion).toBe('5.0.3');
    expect(inventory.tests.map((test) => test.title)).toEqual(['charges the minimum']);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message])).toEqual([
      [
        'config-value-unknown',
        'The config could not be read: permission denied (EACCES), so the scan reads none of its settings.',
      ],
      [
        'unresolved-test-import',
        "'test' is imported from '../fixtures', which could not be read; tests that use it are missing.",
      ],
      [
        'unresolved-test-import',
        "'test' is imported from '@/fixtures', which is not a local file, a path alias or a workspace package; tests that use it are missing.",
      ],
    ]);
  });

  it('reports a source file it may not read without taking it for a test file of includeSource', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': "export default { test: { includeSource: ['src/**/*.ts'] } };\n",
      'src/sma.ts': "if (import.meta.vitest) {\n  import.meta.vitest.it('averages', () => {});\n}\n",
    });
    lock(root, 'src/sma.ts');
    const inventory = await scan({ root, patterns: ['src/*.ts'], framework: 'vitest' });
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.relativeFilePath])).toEqual([
      ['read-error', 'src/sma.ts'],
    ]);
  });

  it('reports a folder it may not open', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/orders.spec.ts': SPEC,
      'tests/locked/fills.spec.ts': SPEC,
    });
    lock(root, 'tests/locked');
    const inventory = await scan({ root, patterns: ['tests/**/*.spec.ts'], framework: 'playwright' });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.relativeFilePath, diagnostic.message])).toEqual([
      ['tests/locked/', 'The folder could not be read: permission denied (EACCES); test files in it are missing.'],
    ]);
  });
});
