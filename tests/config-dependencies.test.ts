import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, type Framework } from '../src/index.ts';
import { expectValidInventory } from './helpers.ts';
import { project } from './project.ts';

interface SetupCase {
  framework: Framework;
  configFile: string;
  config: string;
  spec: string;
  code: string;
}

const SETUP = './setup/trading.js';
const IMPORTED = "test('routes a market order', () => {});";
const GLOBAL = "it('routes a market order', () => {});";

const setups: SetupCase[] = [
  ...['globalSetup', 'globalTeardown'].map((key): SetupCase => ({
    framework: 'playwright',
    configFile: 'playwright.config.ts',
    config: `export default { ${key}: '${SETUP}' };`,
    spec: 'tests/orders.spec.ts',
    code: `import { test } from '@playwright/test'; ${IMPORTED}`,
  })),
  ...['setupFiles', 'globalSetup'].map((key): SetupCase => ({
    framework: 'vitest',
    configFile: 'vitest.config.ts',
    config: `export default { test: { ${key}: ['${SETUP}'] } };`,
    spec: 'tests/orders.test.ts',
    code: `import { test } from 'vitest'; ${IMPORTED}`,
  })),
  ...['setupFiles', 'setupFilesAfterEnv', 'globalSetup', 'globalTeardown'].map((key): SetupCase => ({
    framework: 'jest',
    configFile: 'jest.config.js',
    config: `module.exports = { ${key}: ${key.startsWith('setup') ? `['${SETUP}']` : `'${SETUP}'`} };`,
    spec: 'tests/orders.test.js',
    code: GLOBAL,
  })),
  ...['require', 'file'].map((key): SetupCase => ({
    framework: 'mocha',
    configFile: '.mocharc.json',
    config: JSON.stringify({ spec: 'tests/**/*.test.js', [key]: [SETUP] }),
    spec: 'tests/orders.test.js',
    code: GLOBAL,
  })),
  {
    framework: 'webdriverio',
    configFile: 'wdio.conf.js',
    config: `exports.config = { framework: 'mocha', specs: ['./tests/**/*.spec.js'], mochaOpts: { require: ['${SETUP}'] } };`,
    spec: 'tests/orders.spec.js',
    code: GLOBAL,
  },
  {
    framework: 'jasmine',
    configFile: 'spec/support/jasmine.json',
    config: JSON.stringify({ spec_dir: '', spec_files: ['tests/**/*.spec.js'], helpers: [SETUP] }),
    spec: 'tests/orders.spec.js',
    code: GLOBAL,
  },
  {
    framework: 'bun',
    configFile: 'bunfig.toml',
    config: `[test]\npreload = ['${SETUP}']`,
    spec: 'tests/orders.test.ts',
    code: `import { test } from 'bun:test'; ${IMPORTED}`,
  },
  ...['e2e', 'component'].map((type): SetupCase => ({
    framework: 'cypress',
    configFile: 'cypress.config.ts',
    config: `export default { ${type}: { specPattern: 'tests/**/*.cy.ts', supportFile: '${SETUP}' } };`,
    spec: 'tests/orders.cy.ts',
    code: GLOBAL,
  })),
];

describe('setup dependency coverage', () => {
  it.each(setups)(
    'includes the setup named by $framework config $config',
    async ({ framework, configFile, config, spec, code }) => {
      const root = project({ [configFile]: config, [spec]: code, 'setup/trading.js': "globalThis.venue = 'XNAS';" });
      const options = {
        root,
        framework,
        patterns: [spec],
        frameworkVersion: framework === 'bun' ? '1.3.14' : undefined,
      };
      const before = await scan(options);
      expectValidInventory(before);
      expect(before.tests).toHaveLength(1);
      expect(before.tests[0].dependencies).toContain('setup/trading.js');
      expect(before.tests[0].hasUnfollowedDependencies).toBe(false);
      writeFileSync(path.join(root, 'setup/trading.js'), "globalThis.venue = 'XLON';");
      const after = await scan(options);
      expect(after.tests[0].dependencyHash).not.toBe(before.tests[0].dependencyHash);
    },
  );

  it.each(['--require', '-r', '--import', '--test-global-setup'])(
    'includes a Node %s preload from its test script',
    async (option) => {
      const root = project({
        'package.json': JSON.stringify({ scripts: { test: `node --test ${option} ${SETUP} tests/orders.test.js` } }),
        'setup/trading.js': "globalThis.venue = 'XNAS';",
        'tests/orders.test.js': `import { test } from 'node:test'; ${IMPORTED}`,
      });
      const inventory = await scan({
        root,
        framework: 'node',
        patterns: ['tests/orders.test.js'],
        frameworkVersion: '26.2.0',
      });
      expectValidInventory(inventory);
      expect(inventory.tests[0].dependencies).toContain('setup/trading.js');
      expect(inventory.tests[0].hasUnfollowedDependencies).toBe(false);
    },
  );
});

describe('relocated snapshot diagnostics', () => {
  it.each([
    [
      'playwright',
      'playwright.config.ts',
      'snapshotPathTemplate',
      "{ snapshotPathTemplate: './snapshots/{arg}{ext}' }",
    ],
    ['playwright', 'playwright.config.ts', 'snapshotDir', "{ snapshotDir: './snapshots' }"],
    [
      'playwright',
      'playwright.config.ts',
      'expect.toHaveScreenshot.pathTemplate',
      "{ expect: { toHaveScreenshot: { pathTemplate: './snapshots/{arg}{ext}' } } }",
    ],
    [
      'playwright',
      'playwright.config.ts',
      'expect.toMatchAriaSnapshot.pathTemplate',
      "{ expect: { toMatchAriaSnapshot: { pathTemplate: './snapshots/{arg}{ext}' } } }",
    ],
    ['vitest', 'vitest.config.ts', 'test.resolveSnapshotPath', "{ test: { resolveSnapshotPath: './resolver.js' } }"],
    ['vitest', 'vitest.config.ts', 'test.snapshotEnvironment', "{ test: { snapshotEnvironment: './environment.js' } }"],
    [
      'vitest',
      'vitest.config.ts',
      'test.browser.expect.toMatchScreenshot.resolveScreenshotPath',
      "{ test: { browser: { expect: { toMatchScreenshot: { resolveScreenshotPath: './resolver.js' } } } } }",
    ],
    [
      'vitest',
      'vitest.config.ts',
      'test.browser.expect.toMatchScreenshot.screenshotDirectory',
      "{ test: { browser: { expect: { toMatchScreenshot: { screenshotDirectory: './screenshots' } } } } }",
    ],
    ['jest', 'jest.config.js', 'snapshotResolver', "{ snapshotResolver: './resolver.js' }"],
  ] as const)('marks snapshots moved by %s %s %s', async (framework, configFile, key, config) => {
    const playwright = framework === 'playwright';
    const code = playwright
      ? "import { test, expect } from '@playwright/test'; test('renders the order ticket', async ({ page }) => { await expect(page).toHaveScreenshot('ticket.png'); });"
      : `${framework === 'vitest' ? "import { test, expect } from 'vitest';" : ''} test('renders the order ticket', () => { expect('ticket').toMatchSnapshot(); });`;
    const spec = 'tests/orders.test.ts';
    const inventory = await scan({
      root: project({ [configFile]: `export default ${config};`, [spec]: code }),
      framework,
      patterns: [spec],
    });
    expectValidInventory(inventory);
    expect(inventory.tests[0].hasUnfollowedDependencies).toBe(true);
    expect(inventory.diagnostics.map((item) => item.message)).toContain(
      `${key} puts snapshots where the scan doesn't look, so dependencyHash doesn't cover them.`,
    );
  });
});
