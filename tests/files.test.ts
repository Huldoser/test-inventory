import { symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findFiles, readFailure } from '../src/files.ts';
import { project } from './project.ts';

describe('file discovery boundaries', () => {
  it.each([
    ['EACCES', 'permission denied'],
    ['EPERM', 'permission denied'],
    ['EISDIR', 'it is a folder'],
    ['EMFILE', 'too many files are open'],
  ])('describes %s without exposing a file path', (code, reason) => {
    expect(readFailure({ code, message: 'EXAMPLE private path' })).toBe(`${reason} (${code})`);
  });

  it('can explain an error without an error object', () => {
    expect(readFailure(null)).toBe('unknown error');
  });

  it.each(['vitest', 'mocha'] as const)('keeps a file reached by a %s symbolic link', async (framework) => {
    const root = project({ 'shared/orders.test.ts': '' });
    symlinkSync(path.join(root, 'shared/orders.test.ts'), path.join(root, 'orders.test.ts'));
    const { files, diagnostics } = await findFiles(root, ['*.test.ts'], [], framework);
    expect(files.map((file) => file.relativeFilePath)).toEqual(['orders.test.ts']);
    expect(diagnostics).toEqual([]);
  });

  it('enters a linked Node test folder when any matching pattern names it', async () => {
    const root = project({ 'shared/orders.test.mjs': '', 'tests/quotes.test.mjs': '' });
    symlinkSync(path.join(root, 'shared'), path.join(root, 'tests/.linked'), 'junction');
    const { files, diagnostics } = await findFiles(
      root,
      ['tests/**/*.test.mjs', './tests/.linked/*.test.mjs'],
      [],
      'node',
    );
    expect(files.map((file) => file.relativeFilePath)).toEqual([
      'tests/.linked/orders.test.mjs',
      'tests/quotes.test.mjs',
    ]);
    expect(diagnostics).toEqual([]);
  });

  it('recognizes a linked Node test folder named with Windows path separators', async () => {
    const root = project({ 'shared/orders.test.mjs': '', 'tests/quotes.test.mjs': '' });
    symlinkSync(path.join(root, 'shared'), path.join(root, 'tests/linked'), 'junction');
    const { files, diagnostics } = await findFiles(root, ['tests\\linked\\*.test.mjs'], [], 'node', 'win32');
    expect(files.map((file) => file.relativeFilePath)).toEqual(['tests/linked/orders.test.mjs']);
    expect(diagnostics).toEqual([]);
  });
});
