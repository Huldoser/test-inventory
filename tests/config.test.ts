import { symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { Configs, settingAt, type Setting } from '../src/config.ts';
import { scan, scanSource } from '../src/index.ts';
import { moduleResolver } from '../src/resolve.ts';
import { Values } from '../src/values.ts';
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
      {
        relativeFilePath: 'packages/orders/vitest.config.ts',
        extends: [],
        projects: [{ name: 'orders', testDir: 'packages/orders', dependencies: [] }],
      },
      {
        relativeFilePath: 'vitest.config.ts',
        extends: [],
        projects: [
          { name: 'orders', testDir: 'packages/orders', dependencies: [] },
          { name: 'quotes', testDir: 'packages/quotes', dependencies: [] },
          { name: 'risk', testDir: 'packages/risk', dependencies: [] },
        ],
      },
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
    expect(inventory.configs).toEqual([
      { relativeFilePath: picked, extends: [], projects: [{ name: '', testDir: '.', dependencies: [] }] },
    ]);
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
        projects: [{ name: 'orders', testDir: 'packages/orders', dependencies: [] }],
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
    expect(inventory.configs).toEqual([
      {
        relativeFilePath: 'playwright.config.ts',
        extends: ['playwright.base.ts'],
        projects: [{ name: 'chromium', testDir: 'tests', dependencies: [] }],
      },
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('warns about a config it cannot parse or find the default export of, and still lists it', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/playwright.config.ts': "export default defineConfig({ testDir: '.' );\n",
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
      'tests/playwright.config.ts',
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
        relativeFilePath: 'tests/playwright.config.ts',
        lineStart: 1,
        columnStart: 44,
        testId: null,
        source: ')',
      },
    ]);
  });

  it('leaves out a config name that is a link to itself, as the runners do', async () => {
    const root = project({ 'package.json': VITEST_PACKAGE, 'tests/fees.test.ts': UNIT });
    symlinkSync('vitest.config.ts', path.join(root, 'vitest.config.ts'));
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.configs).toEqual([]);
  });

  it('reports a config that fails to read unexpectedly, and goes on with the scan', async () => {
    const spy = vi.spyOn(Values.prototype, 'constantOf').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    onTestFinished(() => {
      spy.mockRestore();
    });
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': 'const config = { test: { globals: true } };\nexport default config;\n',
      'tests/fees.test.ts': UNIT,
    });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.tests).toHaveLength(1);
    expect(
      inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.relativeFilePath, diagnostic.message]),
    ).toEqual([
      [
        'internal-error',
        'vitest.config.ts',
        'Reading the config failed unexpectedly: Maximum call stack size exceeded, so the scan reads none of its settings.',
      ],
    ]);
  });

  it('reads a config that nests far deeper than real ones', async () => {
    const depth = 3000;
    const nested = `${'{ retry: '.repeat(depth)}1${' }'.repeat(depth)}`;
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': `export default { test: { globals: true, extra: ${nested} } };\n`,
      'tests/fees.test.ts': "describe('fees', () => {\n  it('charges the minimum', () => {});\n});\n",
    });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('globals-not-enabled');
  });

  it('reads a constant used many times once, however deep the uses go', async () => {
    const levels = Array.from(
      { length: 40 },
      (_, index) => `const level${index + 1} = { a: level${index}, b: level${index} };`,
    );
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': [
        'const level0 = { retry: 1 };',
        ...levels,
        'export default { test: { globals: true, extra: level40 } };',
        '',
      ].join('\n'),
      'tests/fees.test.ts': "describe('fees', () => {\n  it('charges the minimum', () => {});\n});\n",
    });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.diagnostics).toEqual([]);
  });

  it("finds no default export in a config that only has export *, which doesn't pass the default on", async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.shared.ts': 'export default { test: { globals: true } };\n',
      'vitest.config.ts': "export * from './vitest.shared';\n",
      'tests/fees.test.ts': UNIT,
    });
    const inventory = await scan({ root, patterns: ['tests/*.test.ts'], framework: 'vitest' });
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'The config has no default export the scan can find, so the scan reads none of its settings.',
    ]);
  });
});

/** A setting as a plain value, with `<unknown>` for one the scan can't work out. */
function plain(setting: Setting | null): unknown {
  if (setting === null) return '<missing>';
  if (setting.kind === 'unknown') return '<unknown>';
  if (setting.kind === 'value') return setting.value;
  if (setting.kind === 'regex') return new RegExp(setting.source, setting.flags);
  if (setting.kind === 'list') return setting.items.map(plain);
  return Object.fromEntries([...setting.keys].map(([key, value]) => [key, plain(value)]));
}

/** The settings of a Vitest config written at the root, as the scan reads them for a test file next to it. */
function settingsOf(code: string): Setting {
  const root = project({ 'vitest.config.ts': code });
  const config = new Configs(root, 'vitest', moduleResolver(root), null).inFolder(root);
  return (config as NonNullable<typeof config>).settings;
}

describe('the config reader', () => {
  it('merges like Vite: lists joined, a single setting taken as a list of one, and null or undefined keeping the base', () => {
    const settings = settingsOf(
      [
        'export default mergeConfig(',
        "  { test: { setupFiles: './tests/setup/clock.ts', environment: null, globals: true } },",
        "  { test: { setupFiles: ['./tests/setup/broker.ts'], environment: 'node', globals: undefined } },",
        ');',
        '',
      ].join('\n'),
    );
    expect(plain(settingAt(settings, ['test']))).toEqual({
      setupFiles: ['./tests/setup/clock.ts', './tests/setup/broker.ts'],
      environment: 'node',
      globals: true,
    });
  });

  it("knows only the file settings of Vitest's configDefaults", () => {
    const settings = settingsOf(
      "import { configDefaults } from 'vitest/config';\nexport default { test: { testTimeout: configDefaults.testTimeout, sequence: configDefaults.typecheck.checker, exclude: configDefaults.exclude } };\n",
    );
    expect(plain(settingAt(settings, ['test']))).toEqual({
      testTimeout: '<unknown>',
      sequence: '<unknown>',
      exclude: ['**/node_modules/**', '**/.git/**'],
    });
  });

  it('takes defaultExclude from vitest/config, and nothing else it exports', () => {
    const settings = settingsOf(
      "import { coverageConfigDefaults, defaultExclude } from 'vitest/config';\nexport default { test: { exclude: defaultExclude, coverage: coverageConfigDefaults } };\n",
    );
    expect(plain(settingAt(settings, ['test']))).toEqual({
      exclude: ['**/node_modules/**', '**/.git/**'],
      coverage: '<unknown>',
    });
  });

  it('takes the keys a config changes after writing it as unknown, and the whole of one Object.assign() changes', () => {
    const settings = settingsOf(
      [
        "const config = { test: { globals: false, environment: 'node' }, mode: 'test', root: '.' };",
        'config.test.globals = true;',
        "config['mode'] += '-ci';",
        'delete config.root;',
        'function local() {',
        "  const config = { cacheDir: '.cache' };",
        "  config.cacheDir = '.local';",
        '}',
        'const shared = { retry: 2 };',
        'Object.assign(shared, { retry: 3 });',
        "const reporters = ['default'];",
        "reporters.push('junit');",
        "process.env.TZ = 'UTC';",
        'loadEnv().CI = true;',
        "const method = 'toString';",
        'config[method]();',
        'export default { ...config, shared, reporters };',
        '',
      ].join('\n'),
    );
    expect(plain(settings)).toEqual({
      test: '<unknown>',
      mode: '<unknown>',
      root: '<unknown>',
      shared: '<unknown>',
      reporters: '<unknown>',
    });
  });

  it('finds no key under a value', () => {
    const settings = settingsOf("export default { test: { environment: 'node' } };\n");
    expect(plain(settingAt(settings, ['test', 'environment', 'name']))).toBe('<missing>');
  });

  it('spreads nothing for null, undefined or false, as JavaScript does', () => {
    const settings = settingsOf(
      "const extra = undefined;\nexport default { test: { globals: true, ...extra, ...null, ...false, environment: 'node' } };\n",
    );
    expect(plain(settingAt(settings, ['test']))).toEqual({ globals: true, environment: 'node' });
  });

  it('keeps what both sides of a condition agree on in a spread, and only that', () => {
    const settings = settingsOf(
      [
        'export default {',
        '  test: {',
        '    globals: true,',
        "    environment: 'node',",
        "    ...(process.env.CI ? { retry: 2, environment: 'node' } : { retry: 0 }),",
        "    ...(process.env.CI && { reporters: ['junit'] }),",
        '  },',
        '};',
        '',
      ].join('\n'),
    );
    expect(plain(settingAt(settings, ['test']))).toEqual({
      globals: true,
      environment: 'node',
      retry: '<unknown>',
      reporters: '<unknown>',
    });
  });

  it('compares the objects both sides of a condition set, key by key', () => {
    const settings = settingsOf(
      [
        'export default {',
        "  test: { environment: 'jsdom' },",
        "  ...(process.env.CI ? { test: { globals: true, retry: 2 }, cacheDir: '.ci' } : { test: { globals: true } }),",
        '};',
        '',
      ].join('\n'),
    );
    expect(plain(settings)).toEqual({ test: { globals: true, retry: '<unknown>' }, cacheDir: '<unknown>' });
  });
});
