import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index.ts';

describe('package entry', () => {
  it('exports the name published in package.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(packageName).toBe(manifest.name);
  });
});
