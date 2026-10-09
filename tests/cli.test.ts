import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { HELP, run } from '../src/cli.ts';
import { toolVersion } from '../src/version.ts';
import { expectValidInventory } from './helpers.ts';
import { PLAYWRIGHT_PACKAGE, project } from './project.ts';

const SPEC =
  "import { test } from '@playwright/test';\ntest.describe('orders', () => {\n  test('fills', async () => {});\n});\n";

async function cli(argv: string[], cwd: string) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out: string[] = [];
  const err: string[] = [];
  stdout.on('data', (chunk: Buffer) => out.push(chunk.toString()));
  stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
  const code = await run(argv, { stdout, stderr, cwd });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

describe('run', () => {
  it('writes compact JSON with a final newline to standard output', async () => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts': SPEC });
    const result = await cli(['tests/**/*.spec.ts', '--framework', 'playwright'], root);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout.endsWith('}\n')).toBe(true);
    expect(result.stdout.split('\n')).toHaveLength(2);
    const inventory = JSON.parse(result.stdout) as unknown;
    expectValidInventory(inventory);
    expect(inventory).toMatchObject({ framework: 'playwright', summary: { testCount: 1 } });
  });

  it('writes indented JSON to a file, with paths relative to --root', async () => {
    const root = project({ 'web/package.json': PLAYWRIGHT_PACKAGE, 'web/tests/orders.spec.ts': SPEC });
    const result = await cli(
      [
        'tests/**/*.spec.ts',
        '--framework=playwright',
        '--root',
        'web',
        '--pretty',
        '-o',
        'inventory.json',
        '--comments',
        'all',
      ],
      root,
    );
    expect(result).toEqual({ code: 0, stdout: '', stderr: '' });
    const text = readFileSync(path.join(root, 'inventory.json'), 'utf8');
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    expect(JSON.parse(text)).toMatchObject({ tests: [{ relativeFilePath: 'tests/orders.spec.ts' }] });
    // The file is written next to its place and renamed when complete, so nothing else is left in the folder.
    expect(readdirSync(root).sort()).toEqual(['inventory.json', 'web']);
  });

  it('leaves no file behind when the output cannot be put in place', async () => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts': SPEC });
    // The output path is a folder, so the finished file cannot be renamed to it.
    const result = await cli(['tests/*.spec.ts', '--framework', 'playwright', '-o', 'tests'], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^test-inventory: could not write tests: /);
    expect(readdirSync(root).sort()).toEqual(['package.json', 'tests']);
  });

  it('says on standard error when no file matches, and still writes the inventory', async () => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts': SPEC });
    const result = await cli(['e2e/**/*.spec.ts', '--framework', 'playwright'], root);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('test-inventory: no test files match "e2e/**/*.spec.ts" in the root.\n');
    expect(JSON.parse(result.stdout)).toMatchObject({ summary: { fileCount: 0 } });
  });

  it.each([
    [
      'ends quietly when the reader closes the pipe',
      () =>
        new Writable({
          write(_chunk, _encoding, callback) {
            callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
          },
        }),
      0,
      '',
    ],
    [
      'reports output that failed before the scan wrote to it',
      () => new Writable().destroy(Object.assign(new Error('write EIO'), { code: 'EIO' })),
      2,
      'test-inventory: could not write the output: error (EIO).\n',
    ],
  ])('%s', async (_, output, exitCode, message) => {
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts': SPEC });
    const stdout = output();
    stdout.on('error', () => undefined);
    const stderr = new PassThrough();
    const err: string[] = [];
    stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
    const result = await run(['tests/*.spec.ts', '--framework', 'playwright'], { stdout, stderr, cwd: root });
    expect(result).toBe(exitCode);
    expect(err.join('')).toBe(message);
  });

  it('passes --ignore and --framework-version to the scan', async () => {
    const root = project({ 'tests/orders.spec.ts': SPEC, 'tests/old/legacy.spec.ts': SPEC });
    const result = await cli(
      ['tests/**/*.spec.ts', '--framework', 'playwright', '--ignore', 'tests/old/**', '--framework-version', '1.42.1'],
      root,
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      frameworkVersion: '1.42.1',
      summary: { fileCount: 1, diagnosticCount: 0 },
    });
  });

  it('prints help and the version', async () => {
    expect(await cli(['--help'], '.')).toEqual({ code: 0, stdout: HELP, stderr: '' });
    expect(await cli(['-v'], '.')).toEqual({ code: 0, stdout: `${toolVersion}\n`, stderr: '' });
  });

  it.each([
    [['--framework', 'playwright'], 'give at least one glob pattern for the test files.'],
    [['tests/**/*.spec.ts'], '--framework is required: playwright or vitest.'],
    [['tests', '--framework', 'jest'], '--framework must be "playwright" or "vitest".'],
    [['tests', '--framework', 'vitest', '--comments', 'some'], '--comments must be "all", "non-active" or "none".'],
    [
      ['tests', '--framework', 'vitest', '--framework-version', 'next'],
      '--framework-version must be a version such as "1.63.0".',
    ],
    [
      ['tests', '--framework', 'vitest', '--root', 'missing'],
      /^--root must be a directory, and .*missing is not one\.$/,
    ],
    [['tests', '--framework', 'vitest', '--retries', '2'], "Unknown option '--retries'"],
    [['tests', '--framework'], "Option '--framework <value>' argument missing"],
  ])('exits with 2 and explains invalid arguments: %j', async (argv, message) => {
    const result = await cli(argv, process.cwd());
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    const [first, second] = result.stderr.split('\n');
    expect(first.replace(/^test-inventory: /, '')).toMatch(message);
    expect(second).toBe('Run test-inventory --help for usage.');
  });

  it('exits with 2 when the output file cannot be written', async () => {
    const root = project({ 'tests/orders.spec.ts': SPEC });
    const result = await cli(['tests/*.spec.ts', '--framework', 'playwright', '-o', 'missing/inventory.json'], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('test-inventory: could not write missing/inventory.json: it does not exist (ENOENT).\n');
  });
});

describe('the built binary', () => {
  const bin = path.resolve(import.meta.dirname, '../dist/bin.js');
  const exec = promisify(execFile);

  it('starts with a shebang and runs a scan', async () => {
    expect(readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    const root = project({ 'package.json': PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts': SPEC });
    const { stdout } = await exec(process.execPath, [bin, 'tests/*.spec.ts', '--framework', 'playwright'], {
      cwd: root,
    });
    expect(JSON.parse(stdout)).toMatchObject({ tool: { name: 'test-inventory', version: toolVersion } });
  });

  it('sets exit code 2 for invalid arguments', async () => {
    await expect(exec(process.execPath, [bin, '--framework', 'vitest'])).rejects.toMatchObject({
      code: 2,
      stderr:
        'test-inventory: give at least one glob pattern for the test files.\nRun test-inventory --help for usage.\n',
    });
  });
});

describe('run with a slow reader', () => {
  it('waits for the output stream to drain', async () => {
    const root = project({
      'tests/orders.spec.ts': `import { test } from '@playwright/test';\n${Array.from({ length: 200 }, (_, index) => `test('quotes symbol ${index}', async () => {});`).join('\n')}\n`,
    });
    const stdout = new PassThrough({ highWaterMark: 16 });
    const chunks: string[] = [];
    let drains = 0;
    stdout.on('drain', () => drains++);
    stdout.on('data', (chunk: Buffer) => {
      stdout.pause();
      chunks.push(chunk.toString());
      setTimeout(() => stdout.resume(), 1);
    });
    const code = await run(['tests/*.spec.ts', '--framework', 'playwright', '--framework-version', '1.63.0'], {
      stdout,
      stderr: new PassThrough(),
      cwd: root,
    });
    expect(code).toBe(0);
    expect(drains).toBeGreaterThan(0);
    expect(JSON.parse(chunks.join(''))).toMatchObject({ summary: { testCount: 200 } });
  });
});
