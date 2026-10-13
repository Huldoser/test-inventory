import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  engines: { node: string };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

// The Dependencies section of CONTRIBUTING.md gives the reason for each.
const EXACT = ['oxc-parser', 'prettier', 'ts-json-schema-generator', 'vitest'];
const TILDE = ['@types/node', 'eslint', 'typescript', 'typescript-eslint'];

/** The range a dependency should have, from the version its range names. */
function expectedRange(name: string, range: string): string {
  const version = /^[~^]?(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/.exec(range)?.[1];
  if (!version) return 'a version number, not a tag, a URL or an open range';
  if (EXACT.includes(name) || name.startsWith('@vitest/') || version.includes('-')) return version;
  return `${TILDE.includes(name) ? '~' : '^'}${version}`;
}

describe('package.json', () => {
  it('gives every dependency the range CONTRIBUTING.md asks for', () => {
    const ranges = { ...manifest.dependencies, ...manifest.devDependencies };
    const expected = Object.fromEntries(
      Object.entries(ranges).map(([name, range]) => [name, expectedRange(name, range)]),
    );
    expect(ranges).toEqual(expected);
  });

  it('types the Node.js APIs of the oldest supported version', () => {
    const oldest = /^>=(\d+\.\d+)$/.exec(manifest.engines.node)?.[1];
    expect(manifest.devDependencies['@types/node']).toBe(`~${oldest}.0`);
  });
});
