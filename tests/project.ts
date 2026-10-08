import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { onTestFinished } from 'vitest';

/** Writes files into a new temporary directory that is removed when the test finishes. */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'test-inventory-'));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

export const PLAYWRIGHT_PACKAGE = JSON.stringify({ devDependencies: { '@playwright/test': '1.63.0' } });
export const VITEST_PACKAGE = JSON.stringify({ devDependencies: { vitest: '5.0.3' } });
