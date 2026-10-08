import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, scanSource, type Inventory } from '../src/index.ts';
import { EXAMPLES, fixtures, goldenPath } from './examples.ts';
import { expectValidInventory } from './helpers.ts';

/** Golden files must not change when the package version does, so the tool version is replaced. */
function golden(inventory: Inventory): string {
  expectValidInventory(inventory);
  return `${JSON.stringify({ ...inventory, tool: { ...inventory.tool, version: '<version>' } }, null, 2)}\n`;
}

describe('golden output', () => {
  it.each(EXAMPLES)('matches for the $name project', async ({ name, framework, patterns }) => {
    const inventory = await scan({ root: path.join(fixtures, name), patterns, framework });
    await expect(golden(inventory)).toMatchFileSnapshot(goldenPath(name));
  });

  describe.each([
    ['playwright', 'playwright.spec.ts', ['1.42.0', '1.49.0', '1.50.0', '1.57.0', '1.60.0', '1.63.0']],
    ['vitest', 'vitest.test.ts', ['3.0.0', '4.0.0', '4.1.0', '5.0.0']],
  ] as const)('of the %s syntax tour', (framework, file, versions) => {
    const code = readFileSync(path.join(fixtures, 'syntax', file), 'utf8');
    it.each(versions)('matches for version %s', async (frameworkVersion) => {
      const inventory = scanSource({ code, relativeFilePath: `tests/${file}`, framework, frameworkVersion });
      await expect(golden(inventory)).toMatchFileSnapshot(`golden/syntax/${framework}-${frameworkVersion}.json`);
    });
  });

  it('of forms for which Playwright refuses the whole file', async () => {
    const file = 'playwright-rejected.spec.ts';
    const code = readFileSync(path.join(fixtures, 'syntax', file), 'utf8');
    const inventory = scanSource({ code, relativeFilePath: `tests/${file}`, framework: 'playwright' });
    await expect(golden(inventory)).toMatchFileSnapshot('golden/syntax/playwright-rejected.json');
  });
});
