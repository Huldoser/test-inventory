import { afterEach, describe, expect, it, vi } from 'vitest';
import { toolVersion } from '../src/version.ts';

describe('bin', () => {
  const argv = process.argv;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('runs the command line with the process arguments and sets the exit code', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.argv = [process.execPath, 'test-inventory', '--version'];
    await import('../src/bin.ts');
    expect(write).toHaveBeenCalledWith(`${toolVersion}\n`);
    expect(process.exitCode).toBe(0);
  });
});
