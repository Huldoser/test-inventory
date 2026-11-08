import { describe, expect, it } from 'vitest';
import { scanPlaywright } from './helpers.ts';
import { scan } from '../src/index.ts';
import { project, VITEST_PACKAGE } from './project.ts';

describe('Playwright modifier aliases', () => {
  it.each([
    ['skip', 'skip', false],
    ['fixme', 'fixme', false],
    ['fail', 'expectedToFail', false],
    ['only', 'active', true],
    ['fail.only', 'expectedToFail', true],
  ])('keeps %s when the declaring function is stored in a variable', (modifier, state, isOnly) => {
    const result = scanPlaywright(`import { test } from '@playwright/test';
const later = test.${modifier};
later('books a partial fill', async () => {});`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]).toMatchObject({ title: 'books a partial fill', state, isOnly });
    expect(result.diagnostics).toEqual([]);
  });

  it('reads an inline choice with the modifiers both branches share', () => {
    const result = scanPlaywright(`import { test } from '@playwright/test';
(process.env.CI ? test.skip : test.skip)('books a paper fill', async () => {});
(process.env.CI ? test.skip : test)('books a live fill', async () => {});`);
    expect(result.tests.map(({ title, state }) => ({ title, state }))).toEqual([
      { title: 'books a paper fill', state: 'skip' },
      { title: 'books a live fill', state: 'active' },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(['process.env.CI && test.skip || test', 'test.skip || test', 'test.skip ?? test', 'test && test.skip'])(
    'reads a logical choice in a variable and inline: %s',
    (choice) => {
      const source = `import { test } from '@playwright/test';
const later = ${choice};
later('books a partial fill', async () => {});
(${choice})('books a full fill', async () => {});`;
      const result = scanPlaywright(source);
      expect(result.tests.map(({ state }) => state)).toEqual([
        choice.startsWith('process.env') ? 'active' : 'skip',
        choice.startsWith('process.env') ? 'active' : 'skip',
      ]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    'process.env.CI && unknownFunction',
    'process.env.CI || unknownFunction',
    'test.skip && unknownFunction',
    'process.env.CI ? test.skip : unknownFunction',
    'process.env.CI ? (process.env.PAPER && test.skip) : test.skip',
    'process.env.CI ? test.describe : (process.env.PAPER ? test.skip : test)',
  ])('does not invent tests from a choice that may hold a different kind of function: %s', (choice) => {
    const result = scanPlaywright(`import { test } from '@playwright/test';
const later = ${choice}; later('books a paper fill', async () => {});`);
    expect(result.tests).toEqual([]);
  });

  it('ignores a helper that can return a function unrelated to Playwright', () => {
    const result = scanPlaywright(`import { test } from '@playwright/test';
function declaration() { if (process.env.CI) return test.skip; return unknownFunction; }
declaration()('books a paper fill', async () => {});`);
    expect(result.tests).toEqual([]);
  });
});

describe('merged Vite aliases', () => {
  it.each([
    "mergeConfig({ resolve: { alias: unknownAliases() } }, { resolve: { alias: [{ find: '@venue', replacement: __dirname + '/src/live.ts' }] } })",
    "mergeConfig({ resolve: { alias: [{ find: '@venue', replacement: __dirname + '/src/live.ts' }] } }, { resolve: { alias: unknownAliases() } })",
    '{ resolve: { alias: [unknownAlias()] } }',
    "{ resolve: { alias: [{ find: unknownName(), replacement: __dirname + '/src/live.ts' }] } }",
    "mergeConfig({ resolve: { alias: { ...unknownAliases() } } }, { resolve: { alias: [{ find: '@venue', replacement: __dirname + '/src/live.ts' }] } })",
    "mergeConfig({ resolve: { alias: { ...unknownAliases() } } }, { resolve: { alias: { '@venue': __dirname + '/src/live.ts' } } })",
    "mergeConfig({ resolve: { alias: { '@venue': __dirname + '/src/live.ts' } } }, { resolve: { alias: { ...unknownAliases() } } })",
  ])('keeps unreadable aliases visible when merged with a list: %s', async (settings) => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': `import { mergeConfig } from 'vitest/config'; export default ${settings};`,
      'src/live.ts': 'export const price = 101;',
      'tests/orders.test.ts': `import { test } from 'vitest'; import { fee } from '@fees';
test('charges the live venue fee', () => { fee(); });`,
    });
    const result = await scan({ root, framework: 'vitest' });
    expect(result.tests[0].hasUnfollowedDependencies).toBe(true);
    expect(result.diagnostics.some(({ code }) => code === 'dependency-not-followed')).toBe(true);
  });
  it.each([
    [
      "[{ find: '@venue', replacement: __dirname + '/src/paper.ts' }, { find: '@fees', replacement: __dirname + '/src/fees.ts' }]",
      "[{ find: '@venue', replacement: __dirname + '/src/live.ts' }]",
    ],
    [
      "{ '@venue': __dirname + '/src/paper.ts', '@fees': __dirname + '/src/fees.ts' }",
      "[{ find: '@venue', replacement: __dirname + '/src/live.ts' }]",
    ],
    [
      "[{ find: '@venue', replacement: __dirname + '/src/paper.ts' }, { find: '@fees', replacement: __dirname + '/src/fees.ts' }]",
      "{ '@venue': __dirname + '/src/live.ts' }",
    ],
    [
      "{ '@venue': __dirname + '/src/paper.ts', '@fees': __dirname + '/src/fees.ts' }",
      "{ '@venue': __dirname + '/src/live.ts' }",
    ],
  ])('uses the overriding alias without losing other aliases: %s', async (base, over) => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': `import { mergeConfig } from 'vitest/config';
export default mergeConfig({ resolve: { alias: ${base} } }, { resolve: { alias: ${over} } });`,
      'src/paper.ts': 'export const price = 100;',
      'src/live.ts': 'export const price = 101;',
      'src/fees.ts': 'export const fee = 1;',
      'tests/orders.test.ts': `import { test, expect } from 'vitest';
import { price } from '@venue'; import { fee } from '@fees';
test('charges the live venue fee', () => expect(price + fee).toBe(102));`,
    });
    const result = await scan({ root, framework: 'vitest' });
    expect(result.tests[0].dependencies).toEqual([
      'src/fees.ts',
      'src/live.ts',
      'tests/orders.test.ts',
      'vitest.config.ts',
    ]);
    expect(result.tests[0].hasUnfollowedDependencies).toBe(false);
  });
});
