import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { diffInventories, filterInventory, scan, type Inventory } from '../src/index.ts';
import { project, VITEST_PACKAGE } from './project.ts';

const registry =
  "import { test } from 'vitest'; import { venues } from './registry'; test('registers trading venues', () => Object.values(venues));";
const files = {
  'package.json': VITEST_PACKAGE,
  'registry.test.ts': registry,
  'registry.ts':
    "export const venues = import.meta.glob(['./venues/**/*.ts', '!./venues/retired.ts'], { eager: true });",
  'venues/auction.ts': "export { price } from '../market';",
  'venues/retired.ts': 'export const price = 0;',
  'market.ts': 'export const price = 101;',
};
const inventory = (root: string) => scan({ root, framework: 'vitest', patterns: ['registry.test.ts'] });

it('matches new and renamed venue modules from a saved scan and hashes their transitive sources', async () => {
  const root = project(files);
  const before = await inventory(root);
  const [test] = before.tests;
  expect(test.hasUnfollowedDependencies).toBe(false);
  expect(test.dependencies).toEqual(['market.ts', 'registry.test.ts', 'registry.ts', 'venues/auction.ts']);
  const selected = (file: string) =>
    filterInventory(JSON.parse(JSON.stringify(before)) as Inventory, { related: [file] }).tests.length;
  for (const file of ['venues/closing.ts', 'venues/sub/closing.ts', 'venues/auction.ts', 'market.ts'])
    expect(selected(file)).toBe(1);
  for (const file of ['venues/retired.ts', 'other/closing.ts', 'venues/.hidden.ts', 'venues/node_modules/new.ts'])
    expect(selected(file)).toBe(0);
  writeFileSync(path.join(root, 'market.ts'), 'export const price = 107;');
  expect((await inventory(root)).tests[0].dependencyHash).not.toBe(test.dependencyHash);
  renameSync(path.join(root, 'venues/auction.ts'), path.join(root, 'venues/opening.ts'));
  const after = await inventory(root);
  expect(after.tests[0].dependencies).toContain('venues/opening.ts');
  expect(after.tests[0].dependencies).not.toContain('venues/auction.ts');
});

it('retains independent exclusions for multiple globs and matches future files in an empty directory', async () => {
  const root = project({
    ...files,
    'registry.ts':
      "export const venues = {...import.meta.glob(['./venues/*.ts','!./venues/retired.ts']), ...import.meta.glob('./venues/*.ts'), ...import.meta.glob('./new/*.ts')};",
  });
  mkdirSync(path.join(root, 'new'));
  const data = await inventory(root);
  expect(data.tests[0].hasUnfollowedDependencies).toBe(false);
  expect(filterInventory(data, { related: ['new/new-venue.ts'] }).tests).toHaveLength(1);
  expect(filterInventory(data, { related: ['venues/retired.ts'] }).tests).toHaveLength(1);
});

it.each([
  '()',
  '(pattern)',
  '([])',
  "(['!./venues/*.ts'])",
  "('@venues/*.ts')",
  "('./venues/{a,b}.ts')",
  "('./venues/*/../market.ts')",
  "('../../external/*.ts')",
  "('./node_modules/*.ts')",
  "('./venues/*.ts', opts)",
  "('./venues/*.ts', {query:'?raw'})",
  "('./venues/*.ts', {eager:true}, {})",
])('keeps unresolved venue glob %s conservative', async (args) => {
  const root = project({ ...files, 'registry.ts': 'export const venues = import.meta.glob' + args + ';' });
  expect((await inventory(root)).tests[0].hasUnfollowedDependencies).toBe(true);
});

it('keeps a linked venue folder unknown', async () => {
  const root = project({ ...files, 'registry.ts': "export const venues = import.meta.glob('./linked/*.ts');" });
  symlinkSync(path.join(root, 'venues'), path.join(root, 'linked'), 'junction');
  expect((await inventory(root)).tests[0].hasUnfollowedDependencies).toBe(true);
});

it('filters and compares older complete records without changing the input', async () => {
  const root = project({ ...files, 'registry.ts': 'export const venues = {}' });
  const current = await inventory(root);
  const old = structuredClone(current);
  Reflect.deleteProperty(old.tests[0], 'dependencyGlobs');
  expect(diffInventories(old, current).changes).toEqual([]);
  expect(filterInventory(old, { related: ['other.ts'] }).tests).toHaveLength(0);
  expect(old.tests[0]).not.toHaveProperty('dependencyGlobs');
});

it('follows a fixed Node module path with a varying query and tracks the query expression', async () => {
  const root = project({
    'fees.mjs': 'export const fee = 5;',
    'sequence.mjs': 'export const sequence = 2;',
    'fees.test.mjs':
      "import test from 'node:test'; import { sequence } from './sequence.mjs'; test('reads the session fee', async () => import(`./fees.mjs?session=${sequence}`));",
  });
  const result = await scan({ root, framework: 'node', patterns: ['fees.test.mjs'] });
  expect(result.tests[0].dependencies).toEqual(['fees.mjs', 'fees.test.mjs', 'sequence.mjs']);
  expect(result.tests[0].hasUnfollowedDependencies).toBe(false);
});

it('follows a glob from a nested module into a sibling folder', async () => {
  const root = project({
    ...files,
    'registry.ts': "export {venues} from './markets/register';",
    'markets/register.ts': "export const venues = import.meta.glob('../venues/*.ts');",
  });
  const data = await inventory(root);
  expect(data.tests[0].dependencies).toContain('venues/auction.ts');
  symlinkSync(path.join(root, 'markets'), path.join(root, 'venues', 'other'), 'junction');
  expect((await inventory(root)).tests[0].hasUnfollowedDependencies).toBe(true);
});

it('keeps the legacy globEager call unresolved', async () => {
  const root = project({ ...files, 'registry.ts': "export const venues = import.meta.globEager('./venues/*.ts');" });
  expect((await inventory(root)).tests[0].hasUnfollowedDependencies).toBe(true);
});

it('changes the hash when a glob acquires an empty venue module', async () => {
  const root = project(files);
  const before = await inventory(root);
  writeFileSync(path.join(root, 'venues/closing.ts'), '');
  const after = await inventory(root);
  expect(after.tests[0].dependencies).toContain('venues/closing.ts');
  expect(after.tests[0].dependencyHash).not.toBe(before.tests[0].dependencyHash);
});

it('selects each test sharing a saved venue pattern', async () => {
  const root = project({
    ...files,
    'registry.test.ts': registry + "\ntest('publishes session venues', () => Object.values(venues));",
  });
  const before = await inventory(root);
  expect(filterInventory(before, { related: ['venues/next.ts'] }).tests).toHaveLength(2);
});
