import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/cli.ts';

vi.mock('../src/scan.ts', () => ({
  scan: vi.fn((options: { patterns: string[] }) =>
    // A thrown value need not be an Error; the CLI reports both kinds.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    Promise.reject(options.patterns[0] === 'string' ? 'a thrown string' : new Error('glob engine exploded')),
  ),
}));

describe('run', () => {
  it.each([
    ['error', /^test-inventory: unexpected error: Error: glob engine exploded\n {4}at /],
    ['string', /^test-inventory: unexpected error: a thrown string\n$/],
  ])('exits with 2 and prints the cause of an unexpected %s', async (pattern, message) => {
    const stderr = new PassThrough();
    const err: string[] = [];
    stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
    const code = await run([pattern, '--framework', 'vitest'], {
      stdout: new PassThrough(),
      stderr,
      cwd: process.cwd(),
    });
    expect(code).toBe(2);
    expect(err.join('')).toMatch(message);
  });
});
