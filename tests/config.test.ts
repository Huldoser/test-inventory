import { describe, expect, it } from 'vitest';
import { scan, scanSource } from '../src/index.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

const SPEC = "import { test } from '@playwright/test';\ntest('places a market order', async () => {});\n";
const UNIT = "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n";

describe('configs', () => {
  it('lists the config each scanned file uses: the nearest one in its folder or above, up to the root', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': "export default defineConfig({ test: { projects: ['packages/*'] } });\n",
      'packages/orders/vitest.config.ts': "export default defineProject({ test: { name: 'orders' } });\n",
      'packages/orders/src/fees.test.ts': UNIT,
      'packages/orders/src/routing.test.ts': UNIT,
      'packages/quotes/src/feed.test.ts': UNIT,
      'packages/risk/vitest.config.ts': "export default defineProject({ test: { name: 'risk' } });\n",
    });
    const inventory = await scan({ root, patterns: ['packages/*/src/*.test.ts'], framework: 'vitest' });
    expect(inventory.configs).toEqual([
      { relativeFilePath: 'packages/orders/vitest.config.ts', extends: [] },
      { relativeFilePath: 'vitest.config.ts', extends: [] },
    ]);
  });

  it.each([
    ['vitest', ['vite.config.ts', 'vitest.config.js', 'vitest.config.mts'], 'vitest.config.mts', 'tests/fees.test.ts'],
    ['playwright', ['playwright.config.mjs', 'playwright.config.js'], 'playwright.config.js', 'tests/orders.spec.ts'],
  ] as const)('picks the %s config the runner picks in a folder', async (framework, names, picked, test) => {
    const configs = Object.fromEntries(names.map((name) => [name, 'export default {};\n']));
    const manifest = framework === 'vitest' ? VITEST_PACKAGE : PLAYWRIGHT_PACKAGE;
    const root = project({ 'package.json': manifest, ...configs, [test]: framework === 'vitest' ? UNIT : SPEC });
    const inventory = await scan({ root, patterns: [test], framework });
    expect(inventory.configs).toEqual([{ relativeFilePath: picked, extends: [] }]);
  });

  it("lists no config for files without one, and leaves out the other framework's config", async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'vitest.config.ts': 'export default {};\n',
      'tests/orders.spec.ts': SPEC,
    });
    expect((await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' })).configs).toEqual([]);
    const inventory = scanSource({ code: SPEC, relativeFilePath: 'tests/orders.spec.ts', framework: 'playwright' });
    expect(inventory.configs).toEqual([]);
  });

  it('lists the files a Vitest config builds on, through a workspace package and its re-exports', async () => {
    const root = project({
      'package.json': JSON.stringify({ workspaces: ['packages/*'], devDependencies: { vitest: '5.0.3' } }),
      'packages/vitest-config/package.json': JSON.stringify({ name: '@trading/vitest-config', exports: './index.ts' }),
      'packages/vitest-config/index.ts': "export * from './broker.ts';\n",
      'packages/vitest-config/broker.ts':
        "export const brokerDefaults = defineConfig({ test: { globals: true, environment: 'node' } });\n",
      'packages/orders/vitest.config.ts': [
        "import { defineProject, mergeConfig } from 'vitest/config';",
        "import { brokerDefaults } from '@trading/vitest-config';",
        '',
        "export default mergeConfig(brokerDefaults, defineProject({ test: { name: 'orders' } }));",
        '',
      ].join('\n'),
      'packages/orders/src/fees.test.ts': "describe('fees', () => {\n  it('charges the minimum', () => {});\n});\n",
    });
    const inventory = await scan({ root, patterns: ['packages/orders/src/*.test.ts'], framework: 'vitest' });
    expect(inventory.configs).toEqual([
      {
        relativeFilePath: 'packages/orders/vitest.config.ts',
        extends: ['packages/vitest-config/index.ts', 'packages/vitest-config/broker.ts'],
      },
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('lists a Playwright base config passed to defineConfig with the settings that override it', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'playwright.base.ts':
        "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ retries: 2 });\n",
      'playwright.config.ts': [
        "import { defineConfig } from '@playwright/test';",
        "import base from './playwright.base';",
        '',
        "export default defineConfig(base, { testDir: './tests', projects: [{ name: 'chromium' }] });",
        '',
      ].join('\n'),
      'tests/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(inventory.configs).toEqual([{ relativeFilePath: 'playwright.config.ts', extends: ['playwright.base.ts'] }]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('warns about a config it cannot parse or find the default export of, and still lists it', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'playwright.config.ts': "export default defineConfig({ testDir: './tests' );\n",
      'tests/orders.spec.ts': SPEC,
      'e2e/playwright.config.ts': "export const config = { testDir: '.' };\n",
      'e2e/checkout.spec.ts': SPEC,
      'admin/playwright.config.ts': 'export default defineConfig({\n',
      'admin/users.spec.ts': SPEC,
    });
    const patterns = ['tests/*.spec.ts', 'e2e/*.spec.ts', 'admin/*.spec.ts'];
    const inventory = await scan({ root, patterns, framework: 'playwright' });
    expect(inventory.configs.map((config) => config.relativeFilePath)).toEqual([
      'admin/playwright.config.ts',
      'e2e/playwright.config.ts',
      'playwright.config.ts',
    ]);
    expect(inventory.diagnostics).toEqual([
      {
        code: 'config-value-unknown',
        level: 'warning',
        message:
          'The config could not be parsed: Expected `}` but found `EOF`, so the scan reads none of its settings.',
        relativeFilePath: 'admin/playwright.config.ts',
        lineStart: 2,
        columnStart: 1,
        testId: null,
        source: null,
      },
      {
        code: 'config-value-unknown',
        level: 'warning',
        message: 'The config has no default export the scan can find, so the scan reads none of its settings.',
        relativeFilePath: 'e2e/playwright.config.ts',
        lineStart: null,
        columnStart: null,
        testId: null,
        source: null,
      },
      {
        code: 'config-value-unknown',
        level: 'warning',
        message:
          'The config could not be parsed: Expected `,` or `}` but found `)`, so the scan reads none of its settings.',
        relativeFilePath: 'playwright.config.ts',
        lineStart: 1,
        columnStart: 50,
        testId: null,
        source: ')',
      },
    ]);
  });
});
