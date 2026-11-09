import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { Inventory } from '../src/index.ts';
import { fixtures } from './examples.ts';

const root = path.resolve(import.meta.dirname, '..');
const example = path.join(root, 'docs/public/examples/scan-skips.mjs');
const fields = ['fullName', 'state', 'condition', 'reason'];

it('publishes the exact complete library script shown in the walkthrough', () => {
  const page = readFileSync(path.join(root, 'docs/guide/workflows.md'), 'utf8');
  const block = /<!-- runnable: scan-skips\.mjs -->\s*```js\n([\s\S]*?)\n```/.exec(page);
  expect(block?.[1]).toBe(readFileSync(example, 'utf8').trimEnd());
});

it('runs the CLI and complete library example with the same query and preserves conditions', () => {
  const project = path.join(fixtures, 'trading-web');
  const library = JSON.parse(execFileSync(process.execPath, [example, project], { encoding: 'utf8' })) as Inventory;
  const cli = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(root, 'dist/bin.js'),
        'tests/**/*.spec.ts',
        '--framework',
        'playwright',
        '--state',
        'skip',
        '--state',
        'fixme',
        '--state',
        'todo',
        '--fields',
        fields.join(','),
        '--pretty',
      ],
      { cwd: project, encoding: 'utf8' },
    ),
  ) as Inventory;
  expect(library).toEqual(cli);
  expect(library.tests.length).toBeGreaterThan(0);
  expect(library.tests.every((test) => ['skip', 'fixme', 'todo'].includes(test.state))).toBe(true);
  expect(library.tests.some((test) => test.condition?.includes('webkit'))).toBe(true);
});

it('type checks the downloadable example against the published library declarations', () => {
  execFileSync(
    process.execPath,
    [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tests/docs-examples.tsconfig.json'],
    { cwd: root, timeout: 15_000, stdio: 'pipe' },
  );
}, 20_000);

it('keeps the no-files diagnostic when the supplied project has no matching tests', () => {
  const project = mkdtempSync(path.join(tmpdir(), 'test-inventory-docs-workflow-'));
  try {
    writeFileSync(
      path.join(project, 'orders.spec.ts'),
      "import { test } from './missing-fixtures'; test('routes a limit order', async () => {});\n",
    );
    const result = spawnSync(process.execPath, [example, project], { encoding: 'utf8' });
    const inventory = JSON.parse(result.stdout) as Inventory;
    expect(result.status).toBe(0);
    expect(inventory.summary.fileCount).toBe(0);
    expect(inventory.diagnostics.some((diagnostic) => diagnostic.code === 'no-files-matched')).toBe(true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

it('exits unsuccessfully with diagnostics when imports leave the scan incomplete', () => {
  const project = mkdtempSync(path.join(tmpdir(), 'test-inventory-docs-incomplete-'));
  try {
    mkdirSync(path.join(project, 'tests'));
    writeFileSync(
      path.join(project, 'tests/orders.spec.ts'),
      "import { test } from './missing-fixtures'; test('routes a limit order', async () => {});\n",
    );
    const result = spawnSync(process.execPath, [example, project], { encoding: 'utf8' });
    const inventory = JSON.parse(result.stdout) as Inventory;
    expect(result.status).toBe(2);
    expect(inventory.diagnostics.some((diagnostic) => diagnostic.code === 'unresolved-test-import')).toBe(true);
    expect(result.stderr).toContain('tests may be missing');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
