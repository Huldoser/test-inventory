import { describe, expect, it } from 'vitest';
import { scan, type Framework, type Inventory } from '../src/index.ts';
import { PLAYWRIGHT_PACKAGE, project } from './project.ts';

const SPEC = "import { test } from '@playwright/test';\ntest('places a market order', async () => {});\n";
const UNIT = "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n";
const GLOBAL_UNIT = "describe('fees', () => {\n  it('charges the minimum', () => {});\n});\n";

/** Scans a project and gives each file's config, and the codes and files of the diagnostics. */
async function placed(
  files: Record<string, string>,
  framework: Framework,
  patterns: string[],
  version = framework === 'vitest' ? '5.0.3' : '1.63.0',
): Promise<{ configs: Record<string, string | null>; diagnostics: string[]; inventory: Inventory }> {
  const manifest =
    framework === 'vitest' ? JSON.stringify({ devDependencies: { vitest: version } }) : PLAYWRIGHT_PACKAGE;
  const root = project({ 'package.json': manifest, ...files });
  const inventory = await scan({ root, patterns, framework });
  return {
    configs: Object.fromEntries(inventory.files.map((file) => [file.relativeFilePath, file.config])),
    diagnostics: inventory.diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.relativeFilePath}`),
    inventory,
  };
}

describe('which Playwright files a config runs', () => {
  it('runs the files under testDir that testMatch matches and testIgnore leaves out, as Playwright does', async () => {
    const { configs, diagnostics } = await placed(
      {
        'playwright.config.ts': [
          "import { defineConfig } from '@playwright/test';",
          "export default defineConfig({ testDir: './e2e', testMatch: /.*\\.e2e\\.ts$/, testIgnore: '**/drafts/**' });",
          '',
        ].join('\n'),
        'e2e/checkout.e2e.ts': SPEC,
        'e2e/drafts/refunds.e2e.ts': SPEC,
        'e2e/orders.spec.ts': SPEC,
        'tests/orders.e2e.ts': SPEC,
      },
      'playwright',
      ['**/*.ts', '!playwright.config.ts'],
    );
    expect(configs).toEqual({
      'e2e/checkout.e2e.ts': 'playwright.config.ts',
      'e2e/drafts/refunds.e2e.ts': 'playwright.config.ts',
      'e2e/orders.spec.ts': 'playwright.config.ts',
      'tests/orders.e2e.ts': 'playwright.config.ts',
    });
    expect(diagnostics).toEqual([
      'file-not-run e2e/drafts/refunds.e2e.ts',
      'file-not-run e2e/orders.spec.ts',
      'file-not-run tests/orders.e2e.ts',
    ]);
  });

  it('matches globs in any case, with **/ in front', async () => {
    const { diagnostics } = await placed(
      {
        'playwright.config.ts': "export default { testMatch: ['Checkout.SPEC.ts', 'vendor/**/*.spec.ts'] };\n",
        'tests/checkout.spec.ts': SPEC,
        'tests/orders.spec.ts': SPEC,
        'tests/vendor/quotes.spec.ts': SPEC,
      },
      'playwright',
      ['tests/**/*.spec.ts'],
    );
    expect(diagnostics).toEqual(['file-not-run tests/orders.spec.ts']);
  });

  it('leaves out what .gitignore files leave out when no testDir is set, as Playwright does', async () => {
    const files = {
      '.gitignore': 'dist/\n# build output\n*.generated.spec.ts\n!keep.generated.spec.ts\n',
      'dist/orders.spec.ts': SPEC,
      'tests/.gitignore': '/local\n',
      'tests/local/orders.spec.ts': SPEC,
      'tests/fills.generated.spec.ts': SPEC,
      'tests/keep.generated.spec.ts': SPEC,
      'tests/orders.spec.ts': SPEC,
    };
    const ignoring = await placed({ ...files, 'playwright.config.ts': 'export default {};\n' }, 'playwright', [
      '**/*.spec.ts',
    ]);
    expect(ignoring.diagnostics).toEqual([
      'file-not-run dist/orders.spec.ts',
      'file-not-run tests/fills.generated.spec.ts',
      'file-not-run tests/local/orders.spec.ts',
    ]);
    const withTestDir = await placed(
      { ...files, 'playwright.config.ts': "export default { testDir: '.' };\n" },
      'playwright',
      ['**/*.spec.ts'],
    );
    expect(withTestDir.diagnostics).toEqual([]);
    const forced = await placed(
      { ...files, 'playwright.config.ts': "export default { testDir: '.', respectGitIgnore: true };\n" },
      'playwright',
      ['**/*.spec.ts'],
    );
    expect(forced.diagnostics).toEqual(ignoring.diagnostics);
  });

  it("takes each project's settings over the config's, and a file any project runs is run", async () => {
    const { diagnostics } = await placed(
      {
        'playwright.config.ts': [
          'export default {',
          "  testDir: './tests',",
          '  projects: [',
          "    { name: 'desktop' },",
          "    { name: 'api', testDir: './api', testMatch: '**/*.api.ts' },",
          '  ],',
          '};',
          '',
        ].join('\n'),
        'tests/orders.spec.ts': SPEC,
        'api/quotes.api.ts': SPEC,
        'api/quotes.spec.ts': SPEC,
      },
      'playwright',
      ['tests/*.ts', 'api/*.ts'],
    );
    expect(diagnostics).toEqual(['file-not-run api/quotes.spec.ts']);
  });

  it.each([
    ["import path from 'node:path';\nexport default { testDir: path.join(__dirname, 'e2e') };\n"],
    ["import * as path from 'path';\nexport default { testDir: path.resolve(import.meta.dirname, './e2e') };\n"],
    [
      "import { join } from 'node:path';\nexport default { testDir: join(path.dirname(__filename), 'e2e') };\nimport path from 'node:path';\n",
    ],
    ["const { dirname, join } = require('path');\nmodule.exports = { testDir: join(dirname(__filename), 'e2e') };\n"],
    [
      "import { fileURLToPath } from 'node:url';\nexport default { testDir: fileURLToPath(new URL('./e2e', import.meta.url)) };\n",
    ],
    [
      "import url from 'node:url';\nimport path from 'node:path';\nexport default { testDir: path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'e2e') };\n",
    ],
    ["const path = require('node:path');\nexport default { testDir: path.join(import.meta.filename, '..', 'e2e') };\n"],
  ])('reads a testDir built from the config file: %s', async (config) => {
    const { diagnostics } = await placed(
      { 'playwright.config.ts': config, 'e2e/checkout.spec.ts': SPEC, 'tests/orders.spec.ts': SPEC },
      'playwright',
      ['**/*.spec.ts'],
    );
    expect(diagnostics).toEqual(['file-not-run tests/orders.spec.ts']);
  });

  it.each([
    ['export default { testDir: process.env.E2E_DIR };\n', 'testDir', 'process.env.E2E_DIR'],
    [
      "import { fileURLToPath } from 'node:url';\nexport default { testDir: fileURLToPath('https://example.com/e2e') };\n",
      'testDir',
      "fileURLToPath('https://example.com/e2e')",
    ],
    [
      "export default { testDir: new URL('e2e', process.env.BASE).pathname };\n",
      'testDir',
      "new URL('e2e', process.env.BASE).pathname",
    ],
    ["export default { testDir: new URL('e2e') };\n", 'testDir', "new URL('e2e')"],
    ['export default { testMatch: [process.env.E2E_GLOB] };\n', 'testMatch', 'process.env.E2E_GLOB'],
    [
      "export default { testIgnore: process.env.CI ? '**/slow/**' : [] };\n",
      'testIgnore',
      "process.env.CI ? '**/slow/**' : []",
    ],
    [
      "export default { respectGitIgnore: process.env.CI === 'true' };\n",
      'respectGitIgnore',
      "process.env.CI === 'true'",
    ],
    [
      "import { desks } from './desks';\nexport default { projects: desks.map((desk) => ({ name: desk })) };\n",
      'projects',
      'desks.map((desk) => ({ name: desk }))',
    ],
    [
      "export default { projects: [{ name: 'desktop', testDir: process.env.DESKTOP_DIR }] };\n",
      'projects testDir',
      'process.env.DESKTOP_DIR',
    ],
    ["import { mobile } from '@trading/devices';\nexport default { projects: [mobile] };\n", 'projects', 'mobile'],
    ['export default { testDir: import.meta.env.E2E_DIR };\n', 'testDir', 'import.meta.env.E2E_DIR'],
    [
      "import path from 'node:path';\nconst SEGMENTS = ['e2e'];\nexport default { testDir: path.join(__dirname, ...SEGMENTS) };\n",
      'testDir',
      'path.join(__dirname, ...SEGMENTS)',
    ],
    [
      "export default { testDir: require('node:path').join(__dirname, 'e2e') };\n",
      'testDir',
      "require('node:path').join(__dirname, 'e2e')",
    ],
    [
      "import path from 'node:path';\nexport default { testDir: path.join(process.cwd(), 'e2e') };\n",
      'testDir',
      "path.join(process.cwd(), 'e2e')",
    ],
    [
      "const { posix: { join } } = require('node:path');\nexport default { testDir: join(__dirname, 'e2e') };\n",
      'testDir',
      "join(__dirname, 'e2e')",
    ],
    [
      "import { TestPaths } from './paths';\nexport default { testDir: new TestPaths(__dirname).e2e };\n",
      'testDir',
      'new TestPaths(__dirname).e2e',
    ],
  ])('takes a config whose file settings it cannot work out to run the file: %s', async (config, key, source) => {
    const { configs, inventory } = await placed(
      { 'playwright.config.ts': config, 'tests/orders.spec.ts': SPEC },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(configs).toEqual({ 'tests/orders.spec.ts': 'playwright.config.ts' });
    expect(
      inventory.diagnostics
        // The config's own imports that can't be read are also dependencyHash warnings, tested with it.
        .filter((diagnostic) => diagnostic.code !== 'dependency-not-followed')
        .map((diagnostic) => [diagnostic.message.split(' could')[0], diagnostic.source]),
    ).toEqual([[`The config's ${key}`, source]]);
  });
  it('takes a setting the config changes after writing it as unknown', async () => {
    const { configs, inventory } = await placed(
      {
        'tests/library/playwright.config.ts': [
          "import path from 'node:path';",
          "const config = { testDir: path.join(__dirname, '..'), retries: 2, projects: [] };",
          "for (const browserName of ['chromium', 'webkit']) {",
          "  config.projects.push({ name: `${browserName}-library`, testDir: path.join(config.testDir, 'library') });",
          '}',
          'export default config;',
          '',
        ].join('\n'),
        'tests/library/orders.spec.ts': SPEC,
      },
      'playwright',
      ['tests/**/*.spec.ts'],
    );
    expect(configs).toEqual({ 'tests/library/orders.spec.ts': 'tests/library/playwright.config.ts' });
    expect(
      inventory.diagnostics.map((diagnostic) => [diagnostic.message.split(' could')[0], diagnostic.source]),
    ).toEqual([
      [
        "The config's projects",
        "config.projects.push({ name: `${browserName}-library`, testDir: path.join(config.testDir, 'library') })",
      ],
    ]);
  });

  it('takes a config whose file setting has the wrong type to run the file, with nothing to point at', async () => {
    const { configs, diagnostics } = await placed(
      { 'playwright.config.ts': 'export default { testDir: 42 };\n', 'tests/orders.spec.ts': SPEC },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(configs).toEqual({ 'tests/orders.spec.ts': 'playwright.config.ts' });
    expect(diagnostics).toEqual([]);
  });
});

describe('which config a file uses', () => {
  it('takes the outermost config that runs the file, as the runner started at the root does', async () => {
    const { configs, diagnostics } = await placed(
      {
        'vitest.config.ts': "export default { test: { globals: true, include: ['packages/**/*.test.ts'] } };\n",
        'packages/orders/vite.config.ts': "export default { build: { lib: { entry: 'src/index.ts' } } };\n",
        'packages/orders/src/fees.test.ts': GLOBAL_UNIT,
        'packages/orders/bench/fees.test.ts': UNIT,
      },
      'vitest',
      ['packages/**/*.test.ts'],
    );
    expect(configs).toEqual({
      'packages/orders/bench/fees.test.ts': 'vitest.config.ts',
      'packages/orders/src/fees.test.ts': 'vitest.config.ts',
    });
    expect(diagnostics).toEqual([]);
  });

  it('takes a nested config when the outer one does not run the file, and the nearest when none does', async () => {
    const { configs, diagnostics, inventory } = await placed(
      {
        'vitest.config.ts': "export default { test: { include: ['tests/**/*.test.ts'] } };\n",
        'tests/fees.test.ts': UNIT,
        'packages/quotes/vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'] } };\n",
        'packages/quotes/src/feed.test.ts': UNIT,
        'packages/quotes/scripts/replay.test.ts': UNIT,
        'packages/quotes/scripts/empty.test.ts': '// replays a recorded feed by hand\n',
      },
      'vitest',
      ['**/*.test.ts'],
    );
    expect(configs).toEqual({
      'packages/quotes/scripts/empty.test.ts': 'packages/quotes/vitest.config.ts',
      'packages/quotes/scripts/replay.test.ts': 'packages/quotes/vitest.config.ts',
      'packages/quotes/src/feed.test.ts': 'packages/quotes/vitest.config.ts',
      'tests/fees.test.ts': 'vitest.config.ts',
    });
    expect(diagnostics).toEqual(['file-not-run packages/quotes/scripts/replay.test.ts']);
    expect(inventory.diagnostics[0].message).toBe(
      "The file has tests, but no config in its folder or above runs it, so the runner doesn't collect them; the nearest config is packages/quotes/vitest.config.ts.",
    );
    expect(inventory.configs.map((config) => config.relativeFilePath)).toEqual([
      'packages/quotes/vitest.config.ts',
      'vitest.config.ts',
    ]);
  });

  it('prefers a config that runs the file to an outer one whose files it cannot work out', async () => {
    const { configs, diagnostics } = await placed(
      {
        'playwright.config.ts': "import { e2e } from '@trading/e2e-config';\nexport default e2e;\n",
        'apps/admin/playwright.config.ts': "export default { testDir: './e2e' };\n",
        'apps/admin/e2e/users.spec.ts': SPEC,
        'tests/orders.spec.ts': SPEC,
      },
      'playwright',
      ['**/*.spec.ts'],
    );
    expect(configs).toEqual({
      'apps/admin/e2e/users.spec.ts': 'apps/admin/playwright.config.ts',
      'tests/orders.spec.ts': 'playwright.config.ts',
    });
    expect(diagnostics).toEqual(['config-value-unknown playwright.config.ts']);
  });

  it('has no config and no warning for a file without a config above it', async () => {
    const { configs, diagnostics } = await placed({ 'tests/fees.test.ts': UNIT }, 'vitest', ['tests/*.test.ts']);
    expect(configs).toEqual({ 'tests/fees.test.ts': null });
    expect(diagnostics).toEqual([]);
  });
});

describe('which Vitest files a config runs', () => {
  it("excludes what each version's defaults exclude", async () => {
    const files = { 'vitest.config.ts': 'export default {};\n', 'dist/fees.test.ts': UNIT, 'src/fees.test.ts': UNIT };
    expect((await placed(files, 'vitest', ['**/*.test.ts'], '3.2.4')).diagnostics).toEqual([
      'file-not-run dist/fees.test.ts',
    ]);
    expect((await placed(files, 'vitest', ['**/*.test.ts'], '4.1.0')).diagnostics).toEqual([]);
  });

  it('finds the files from test.dir in test.root, or from Vite root, and reads exclude and includeSource', async () => {
    const { diagnostics } = await placed(
      {
        'vitest.config.ts': [
          'export default {',
          "  root: './app',",
          "  test: { dir: 'src', include: ['**/*.spec.ts'], exclude: ['**/legacy/**'], includeSource: ['**/*.ts'] },",
          '};',
          '',
        ].join('\n'),
        'app/src/fees.spec.ts': UNIT,
        'app/src/legacy/fees.spec.ts': UNIT,
        'app/src/sma.ts':
          "export const sma = 1;\nif (import.meta.vitest) {\n  const { it } = import.meta.vitest;\n  it('averages', () => {});\n}\n",
        'app/fees.spec.ts': UNIT,
        'src/fees.spec.ts': UNIT,
      },
      'vitest',
      ['**/*.spec.ts', 'app/src/sma.ts'],
    );
    expect(diagnostics).toEqual([
      'file-not-run app/fees.spec.ts',
      'file-not-run app/src/legacy/fees.spec.ts',
      'file-not-run src/fees.spec.ts',
    ]);
  });

  it("reads Vitest's own defaults from vitest/config, for the project's version", async () => {
    const files = {
      'vitest.config.ts': [
        "import { configDefaults, defaultInclude, defineConfig } from 'vitest/config';",
        'export default defineConfig({',
        '  test: {',
        "    include: [...defaultInclude, 'checks/**/*.ts'],",
        "    exclude: [...configDefaults.exclude, 'tests/fixtures/**'],",
        '    typecheck: { enabled: true, include: configDefaults.typecheck.include },',
        '  },',
        '});',
        '',
      ].join('\n'),
      'tests/fees.test.ts': UNIT,
      'tests/fixtures/orders.test.ts': UNIT,
      'checks/orders.ts': UNIT,
      'dist/fees.test.ts': UNIT,
      'types/orders.test-d.ts': "import { test } from 'vitest';\ntest('types an order', () => {});\n",
    };
    const patterns = ['**/*.ts', '!vitest.config.ts'];
    expect((await placed(files, 'vitest', patterns)).diagnostics).toEqual([
      'file-not-run tests/fixtures/orders.test.ts',
    ]);
    expect((await placed(files, 'vitest', patterns, '3.2.4')).diagnostics).toEqual([
      'file-not-run dist/fees.test.ts',
      'file-not-run tests/fixtures/orders.test.ts',
    ]);
  });

  it('takes test.root over Vite root, and runs type tests only with typecheck on', async () => {
    const files = {
      'checks/orders.test-d.ts': "import { expectTypeOf, test } from 'vitest';\ntest('types an order', () => {});\n",
      'checks/orders.test.ts': UNIT,
    };
    const off = await placed(
      { ...files, 'vitest.config.ts': "export default { root: './elsewhere', test: { root: './checks' } };\n" },
      'vitest',
      ['checks/*'],
    );
    expect(off.diagnostics).toEqual(['file-not-run checks/orders.test-d.ts']);
    const on = await placed(
      { ...files, 'vitest.config.ts': 'export default { test: { typecheck: { enabled: true } } };\n' },
      'vitest',
      ['checks/*'],
    );
    expect(on.diagnostics).toEqual([]);
  });

  it('marks the files benchmark.include names as benchmarks, in place of the default names', async () => {
    const { inventory, diagnostics } = await placed(
      {
        'vitest.config.ts': "export default { test: { benchmark: { include: ['perf/**/*.ts'] } } };\n",
        'perf/sma.ts': "import { test } from 'vitest';\ntest('averages a year of candles', () => {});\n",
        'src/sma.bench.ts': "import { test } from 'vitest';\ntest('averages a month of candles', () => {});\n",
      },
      'vitest',
      ['perf/*.ts', 'src/*.ts'],
    );
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.isBenchmark])).toEqual([
      ['perf/sma.ts', true],
      ['src/sma.bench.ts', false],
    ]);
    expect(diagnostics).toEqual(['file-not-run src/sma.bench.ts']);
  });

  it('places a file in the project that runs it: inline, a config file, or a folder', async () => {
    const { configs, diagnostics } = await placed(
      {
        'vitest.config.ts': [
          'export default {',
          '  test: {',
          '    globals: true,',
          "    projects: [{ test: { name: 'unit', include: ['tests/**/*.test.ts'] } }, 'packages/*', './tools/vitest.lint.config.ts'],",
          '  },',
          '};',
          '',
        ].join('\n'),
        'tests/fees.test.ts': GLOBAL_UNIT,
        'packages/quotes/vitest.config.ts': "export default { test: { name: 'quotes', globals: true } };\n",
        'packages/quotes/src/feed.test.ts': GLOBAL_UNIT,
        'packages/orders/src/routing.test.ts': GLOBAL_UNIT,
        'tools/vitest.lint.config.ts': "export default { test: { include: ['rules/**/*.test.ts'] } };\n",
        'tools/rules/naming.test.ts': UNIT,
      },
      'vitest',
      ['**/*.test.ts'],
    );
    expect(configs).toEqual({
      'packages/orders/src/routing.test.ts': 'vitest.config.ts',
      'packages/quotes/src/feed.test.ts': 'packages/quotes/vitest.config.ts',
      'tests/fees.test.ts': 'vitest.config.ts',
      'tools/rules/naming.test.ts': 'tools/vitest.lint.config.ts',
    });
    // The orders folder has no config, so its project has Vitest's defaults, without the root's globals.
    expect(diagnostics).toEqual(['globals-not-enabled packages/orders/src/routing.test.ts']);
  });

  it.each([
    ['5.0.3', undefined, []],
    ['5.0.3', false, ['globals-not-enabled tests/fees.test.ts']],
    ['4.1.0', undefined, ['globals-not-enabled tests/fees.test.ts']],
    ['4.1.0', true, []],
  ])(
    'lets an inline project inherit the root config in Vitest %s with extends %s',
    async (version, extended, expected) => {
      const inline =
        extended === undefined ? "{ test: { name: 'unit' } }" : `{ extends: ${extended}, test: { name: 'unit' } }`;
      const { diagnostics } = await placed(
        {
          'vitest.config.ts': `export default { test: { globals: true, projects: [${inline}] } };\n`,
          'tests/fees.test.ts': GLOBAL_UNIT,
        },
        'vitest',
        ['tests/*.test.ts'],
        version,
      );
      expect(diagnostics).toEqual(expected);
    },
  );

  it.each([
    ['export default { test: { include: [process.env.TEST_GLOB] } };\n', 'test.include'],
    ['export default { test: { dir: process.env.TEST_DIR } };\n', 'test.dir'],
    ["export default { test: { projects: process.env.CI ? ['ci'] : ['local'] } };\n", 'test.projects'],
    ["export default { test: { projects: [() => ({ test: { name: 'unit' } })] } };\n", 'test.projects'],
  ])('takes a Vitest config whose file settings it cannot work out to run the file: %s', async (config, key) => {
    const { configs, inventory } = await placed({ 'vitest.config.ts': config, 'tests/fees.test.ts': UNIT }, 'vitest', [
      'tests/*.test.ts',
    ]);
    expect(configs).toEqual({ 'tests/fees.test.ts': 'vitest.config.ts' });
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message.split(' could')[0])).toEqual([
      `The config's ${key}`,
    ]);
  });
});

describe('which files a config runs, in the cases a review found', () => {
  it('reads a .gitignore line that is only ! and empty Vitest patterns without failing the scan', async () => {
    const playwright = await placed(
      { 'playwright.config.ts': 'export default {};\n', '.gitignore': 'dist\n!\n', 'tests/orders.spec.ts': SPEC },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(playwright.diagnostics).toEqual([]);
    const vitest = await placed(
      {
        'vitest.config.ts': "export default { test: { include: ['', '**/*.test.ts'], exclude: [''] } };\n",
        'tests/fees.test.ts': UNIT,
      },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(vitest.diagnostics).toEqual([]);
  });

  it('takes a testMatch regular expression Node.js rejects as unknown', async () => {
    const { configs, diagnostics } = await placed(
      { 'playwright.config.ts': 'export default { testMatch: /orders{2,1}/ };\n', 'tests/orders.spec.ts': SPEC },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(configs).toEqual({ 'tests/orders.spec.ts': 'playwright.config.ts' });
    expect(diagnostics).toEqual([]);
  });

  it('excludes a folder Vitest exclude names, and reads absolute include patterns', async () => {
    const { diagnostics } = await placed(
      {
        'vitest.config.ts': [
          "import path from 'node:path';",
          "import { configDefaults } from 'vitest/config';",
          'export default {',
          "  test: { include: [path.resolve(__dirname, 'src/**/*.test.ts'), 'e2e/**/*.test.ts'], exclude: [...configDefaults.exclude, 'e2e'] },",
          '};',
          '',
        ].join('\n'),
        'src/fees.test.ts': UNIT,
        'e2e/orders.test.ts': UNIT,
      },
      'vitest',
      ['**/*.test.ts'],
    );
    expect(diagnostics).toEqual(['file-not-run e2e/orders.test.ts']);
  });

  it('leaves out the project folders a negated test.projects entry names', async () => {
    const { configs } = await placed(
      {
        'vitest.config.ts': "export default { test: { include: [], projects: ['packages/*', '!packages/legacy'] } };\n",
        'packages/orders/src/fill.test.ts': UNIT,
        'packages/legacy/src/old.test.ts': UNIT,
      },
      'vitest',
      ['packages/*/src/*.test.ts'],
    );
    expect(configs).toEqual({
      'packages/legacy/src/old.test.ts': 'vitest.config.ts',
      'packages/orders/src/fill.test.ts': 'vitest.config.ts',
    });
    const { diagnostics } = await placed(
      {
        'vitest.config.ts': "export default { test: { projects: ['<rootDir>/packages/*', '!packages/legacy'] } };\n",
        'packages/orders/src/fill.test.ts': UNIT,
        'packages/legacy/src/old.test.ts': UNIT,
      },
      'vitest',
      ['packages/*/src/*.test.ts'],
    );
    expect(diagnostics).toEqual(['file-not-run packages/legacy/src/old.test.ts']);
  });

  it("runs a Vitest 5 config file project's own projects, not its include", async () => {
    const { configs, diagnostics } = await placed(
      {
        'vitest.config.ts': "export default { test: { projects: ['apps/*'] } };\n",
        'apps/web/vitest.config.ts':
          "export default { test: { projects: [{ test: { name: 'unit', include: ['src/**/*.unit.ts'] } }] } };\n",
        'apps/web/src/fill.unit.ts': UNIT,
        'apps/web/src/fill.test.ts': UNIT,
      },
      'vitest',
      ['apps/web/src/*.ts'],
    );
    expect(configs['apps/web/src/fill.unit.ts']).toBe('apps/web/vitest.config.ts');
    expect(diagnostics).toEqual(['file-not-run apps/web/src/fill.test.ts']);
  });

  it('stops at a config whose projects name the config itself', async () => {
    const { configs } = await placed(
      {
        'vitest.config.ts': "export default { test: { projects: ['./vitest.config.ts'] } };\n",
        'tests/fees.test.ts': UNIT,
      },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(configs).toEqual({ 'tests/fees.test.ts': 'vitest.config.ts' });
  });

  it("reads an inline project's extends file", async () => {
    const { diagnostics } = await placed(
      {
        'vitest.shared.ts': "export default { test: { include: ['src/**/*.unit.ts'], globals: true } };\n",
        'vitest.config.ts':
          "export default { test: { projects: [{ extends: './vitest.shared.ts', test: { name: 'unit' } }] } };\n",
        'src/fill.unit.ts': GLOBAL_UNIT,
      },
      'vitest',
      ['src/*.ts'],
    );
    expect(diagnostics).toEqual([]);
  });

  it('runs a file a .gitignore rule brings back inside a folder another rule leaves out, as Playwright does', async () => {
    const { diagnostics } = await placed(
      {
        'playwright.config.ts': 'export default {};\n',
        '.gitignore': 'build/\n!build/keep.spec.ts\n',
        'build/keep.spec.ts': SPEC,
        'build/drop.spec.ts': SPEC,
      },
      'playwright',
      ['build/*.spec.ts'],
    );
    expect(diagnostics).toEqual(['file-not-run build/drop.spec.ts']);
  });

  it('follows .gitignore rules into nested folders, for each project folder', async () => {
    const { diagnostics } = await placed(
      {
        'playwright.config.ts': [
          'export default {',
          "  projects: [{ name: 'all' }, { name: 'reports', testDir: './build', testMatch: '**/*.check.ts', respectGitIgnore: true }],",
          '};',
          '',
        ].join('\n'),
        '.gitignore': 'build/\n!build/**/keep.spec.ts\n!other/keep.spec.ts\ndist/\n',
        'build/.gitignore': 'reports/stale/\n',
        'build/reports/keep.spec.ts': SPEC,
        'build/reports/drop.spec.ts': SPEC,
        'build/reports/stale/fills.check.ts': SPEC,
        'build/reports/fills.check.ts': SPEC,
        'dist/nested/orders.spec.ts': SPEC,
      },
      'playwright',
      ['build/**/*.ts', 'dist/**/*.ts'],
    );
    expect(diagnostics).toEqual([
      'file-not-run build/reports/drop.spec.ts',
      'file-not-run build/reports/stale/fills.check.ts',
      'file-not-run dist/nested/orders.spec.ts',
    ]);
  });

  it('takes a Vitest 3 config with a workspace file, or test.workspace, to run the file it cannot tell about', async () => {
    const files = { 'tests/fees.test.ts': UNIT, 'e2e/orders.e2e.ts': UNIT };
    const workspaceFile = await placed(
      { ...files, 'vitest.config.ts': 'export default {};\n', 'vitest.workspace.ts': "export default ['e2e'];\n" },
      'vitest',
      ['tests/*.ts', 'e2e/*.ts'],
      '3.2.4',
    );
    expect(workspaceFile.diagnostics).toEqual([]);
    const option = await placed(
      {
        ...files,
        'vitest.config.ts': "export default { test: { workspace: [{ test: { include: ['e2e/**/*.e2e.ts'] } }] } };\n",
      },
      'vitest',
      ['tests/*.ts', 'e2e/*.ts'],
      '3.0.0',
    );
    expect(option.diagnostics).toEqual([]);
  });

  it("takes test.root over Vite root also when it is the config's folder", async () => {
    const { diagnostics } = await placed(
      { 'vitest.config.ts': "export default { root: 'src', test: { root: '.' } };\n", 'other/fees.test.ts': UNIT },
      'vitest',
      ['other/*.test.ts'],
    );
    expect(diagnostics).toEqual([]);
  });

  it('runs only type tests with typecheck.only, and reads benchmark.includeSource', async () => {
    const { diagnostics, inventory } = await placed(
      {
        'vitest.config.ts':
          "export default { test: { typecheck: { enabled: true, only: true }, benchmark: { includeSource: ['perf/**/*.ts'] } } };\n",
        'tests/orders.test-d.ts': "import { test } from 'vitest';\ntest('types an order', () => {});\n",
        'tests/orders.test.ts': UNIT,
        'perf/sma.ts':
          "if (import.meta.vitest) {\n  const { test } = import.meta.vitest;\n  test('averages a year of candles', () => {});\n}\n",
      },
      'vitest',
      ['tests/*.ts', 'perf/*.ts'],
    );
    expect(diagnostics).toEqual(['file-not-run tests/orders.test.ts']);
    expect(inventory.tests.find((test) => test.relativeFilePath === 'perf/sma.ts')?.isBenchmark).toBe(true);
  });

  it('takes a config whose typecheck.enabled it cannot work out to run the file', async () => {
    const { inventory } = await placed(
      {
        'vitest.config.ts': 'export default { test: { typecheck: { enabled: !!process.env.TYPECHECK } } };\n',
        'tests/orders.test-d.ts': "import { test } from 'vitest';\ntest('types an order', () => {});\n",
      },
      'vitest',
      ['tests/*.ts'],
    );
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message.split(' could')[0])).toEqual([
      "The config's test.typecheck.enabled",
    ]);
  });

  it('resolves a path.resolve() with no folder from the root, where the runner starts', async () => {
    const { diagnostics } = await placed(
      {
        'apps/web/playwright.config.ts':
          "import path from 'node:path';\nexport default { testDir: path.resolve('apps/web/e2e') };\n",
        'apps/web/e2e/orders.spec.ts': SPEC,
      },
      'playwright',
      ['apps/web/e2e/*.spec.ts'],
    );
    expect(diagnostics).toEqual([]);
  });
});

describe('which files the runner never collects', () => {
  const VALIDATE_ORDER =
    "export function validateLimitOrder(order: { quantity: number }): string | null {\n  return order.quantity > 0 ? null : 'quantity must be positive';\n}\n";

  it('leaves out a shared suite that a collected test file imports, as its tests run in that file', async () => {
    const { diagnostics } = await placed(
      {
        'vitest.config.ts': "export default { test: { include: ['tests/**/*.test.ts'] } };\n",
        'src/orders/limit-order.ts': VALIDATE_ORDER,
        'tests/shared/order-validation.suite.ts': [
          "import { describe, expect, it } from 'vitest';",
          '',
          'export function describeOrderValidation(validate: (order: { quantity: number }) => string | null) {',
          "  describe('order validation', () => {",
          "    it('rejects a zero quantity', () => {",
          "      expect(validate({ quantity: 0 })).toBe('quantity must be positive');",
          '    });',
          '  });',
          '}',
          '',
        ].join('\n'),
        'tests/orders/limit-order.test.ts': [
          "import { describeOrderValidation } from '../shared/order-validation.suite.ts';",
          "import { validateLimitOrder } from '../../src/orders/limit-order.ts';",
          '',
          'describeOrderValidation(validateLimitOrder);',
          '',
        ].join('\n'),
        'tests/shared/market-hours.cases.ts': [
          "import { test } from 'vitest';",
          '',
          "test('treats a Saturday as a closed market', () => {});",
          '',
        ].join('\n'),
        'tests/orders/market-order.test.ts': [
          "import './../shared/market-hours.cases.ts';",
          "import { test } from 'vitest';",
          '',
          "test('fills a market order at the last trade', () => {});",
          '',
        ].join('\n'),
        'tests/strategies/stale-crossover.spec.ts': [
          "import { test } from 'vitest';",
          '',
          "test('holds when the slow average is missing', () => {});",
          '',
        ].join('\n'),
      },
      'vitest',
      ['tests/**/*.ts'],
    );
    expect(diagnostics).toEqual([
      'file-not-run tests/strategies/stale-crossover.spec.ts',
      'test-in-function tests/shared/order-validation.suite.ts',
    ]);
  });
});

describe('which files a config a package.json script names runs', () => {
  const manifest = (devDependencies: Record<string, string>, scripts: Record<string, string>) =>
    JSON.stringify({ devDependencies, scripts });
  const VITEST = { vitest: '5.0.3' };

  it('runs the files a Vitest config passed with --config takes, and still reports a file no config runs', async () => {
    const { configs, diagnostics } = await placed(
      {
        'package.json': manifest(VITEST, {
          test: 'vitest run',
          'test:integration': 'cross-env TZ=UTC vitest run --config vitest.config.integration.mts',
          lint: 'eslint . -c eslint.config.orders.mjs',
        }),
        'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'] } };\n",
        'vitest.config.integration.mts': "export default { test: { include: ['integration/**/*.spec.ts'] } };\n",
        'src/fees.test.ts': UNIT,
        'integration/broker/place-order.spec.ts': UNIT,
        'scripts/replay-feed.test.ts': UNIT,
      },
      'vitest',
      ['**/*.{test,spec}.ts'],
    );
    expect(configs['integration/broker/place-order.spec.ts']).toBe('vitest.config.integration.mts');
    expect(diagnostics).toEqual(['file-not-run scripts/replay-feed.test.ts']);
  });

  it("takes Vitest's root as the folder the script runs in, not the config's folder", async () => {
    const { configs, diagnostics } = await placed(
      {
        'package.json': manifest(VITEST, { 'test:node': 'vitest run --config test/node/vitest.config.mjs' }),
        'test/node/vitest.config.mjs': "export default { test: { include: ['test/node/**/*.test.ts'] } };\n",
        'test/node/indicators/rsi.test.ts': UNIT,
      },
      'vitest',
      ['test/**/*.test.ts'],
    );
    expect(configs).toEqual({ 'test/node/indicators/rsi.test.ts': 'test/node/vitest.config.mjs' });
    expect(diagnostics).toEqual([]);
  });

  it('reads a config a script names from the root it gives Vitest, and takes that root for its globs', async () => {
    const { configs, diagnostics } = await placed(
      {
        'package.json': manifest(VITEST, {
          'test:feed': 'vitest run --root packages/quotes --config vitest.feed.config.ts',
        }),
        'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'] } };\n",
        'packages/quotes/vitest.feed.config.ts': "export default { test: { include: ['feed/**/*.test.ts'] } };\n",
        'packages/quotes/feed/tick-stream.test.ts': UNIT,
      },
      'vitest',
      ['packages/**/*.test.ts'],
    );
    expect(configs).toEqual({ 'packages/quotes/feed/tick-stream.test.ts': 'packages/quotes/vitest.feed.config.ts' });
    expect(diagnostics).toEqual([]);
  });

  it("runs a package's files with Vitest's defaults when its script starts Vitest in a folder without a config", async () => {
    const { configs, diagnostics } = await placed(
      {
        'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'] } };\n",
        'examples/backtest/package.json': manifest(VITEST, { test: 'vitest run' }),
        'examples/backtest/src/crossover.test.ts': UNIT,
      },
      'vitest',
      ['examples/**/*.test.ts'],
    );
    expect(configs).toEqual({ 'examples/backtest/src/crossover.test.ts': null });
    expect(diagnostics).toEqual([]);
  });

  it('runs the files a Jest config passed with -c takes, from its own folder', async () => {
    const { configs, diagnostics } = await placed(
      {
        'package.json': manifest({ jest: '30.2.0' }, { 'test:e2e': 'jest --ci -c ./test/jest-e2e.json' }),
        'jest.config.js': "module.exports = { roots: ['<rootDir>/src'] };\n",
        'test/jest-e2e.json': JSON.stringify({ rootDir: '.', testRegex: '.e2e-spec.ts$' }),
        'test/orders.e2e-spec.ts': GLOBAL_UNIT,
        'test/quotes.smoke.ts': GLOBAL_UNIT,
      },
      'jest',
      ['test/**/*.ts'],
    );
    expect(configs['test/orders.e2e-spec.ts']).toBe('test/jest-e2e.json');
    expect(diagnostics).toEqual(['file-not-run test/quotes.smoke.ts']);
  });

  it('runs the files a Playwright config passed with --config= takes, from its own folder', async () => {
    const { configs, diagnostics } = await placed(
      {
        'package.json': manifest(
          { '@playwright/test': '1.63.0' },
          { 'e2e:mock': 'playwright test --config=e2e/playwright.config.mock.ts' },
        ),
        'e2e/playwright.config.ts': "export default { testDir: 'specs/', testIgnore: ['**/mock/**'] };\n",
        'e2e/playwright.config.mock.ts': "export default { testDir: 'specs/mock/' };\n",
        'e2e/specs/mock/rejected-order.spec.ts': SPEC,
      },
      'playwright',
      ['e2e/specs/**/*.spec.ts'],
    );
    expect(configs).toEqual({ 'e2e/specs/mock/rejected-order.spec.ts': 'e2e/playwright.config.mock.ts' });
    expect(diagnostics).toEqual([]);
  });

  it('runs the files a Cypress or WebdriverIO config a script names takes, where the root config leaves them out', async () => {
    const cypress = await placed(
      {
        'package.json': manifest({ cypress: '15.6.0' }, { 'cy:orders': 'cypress run -C cypress.orders.config.ts' }),
        'cypress.config.ts': "export default { e2e: { specPattern: 'cypress/e2e/**/*.cy.ts' } };\n",
        'cypress.orders.config.ts': "export default { e2e: { specPattern: 'cypress/orders/**/*.cy.ts' } };\n",
        'cypress/orders/limit-order.cy.ts': GLOBAL_UNIT,
      },
      'cypress',
      ['cypress/**/*.cy.ts'],
    );
    expect(cypress.configs).toEqual({ 'cypress/orders/limit-order.cy.ts': 'cypress.orders.config.ts' });
    expect(cypress.diagnostics).toEqual([]);
    const webdriverio = await placed(
      {
        'package.json': manifest({ '@wdio/cli': '9.20.0' }, { 'e2e:android': 'wdio run ./wdio.android.conf.ts' }),
        'wdio.conf.ts': "export const config = { specs: ['./test/**/*.e2e.ts'], exclude: ['./test/android/**'] };\n",
        'wdio.android.conf.ts': "export const config = { specs: ['./test/android/**/*.e2e.ts'] };\n",
        'test/android/watchlist.e2e.ts': GLOBAL_UNIT,
      },
      'webdriverio',
      ['test/**/*.e2e.ts'],
    );
    expect(webdriverio.configs).toEqual({ 'test/android/watchlist.e2e.ts': 'wdio.android.conf.ts' });
    expect(webdriverio.diagnostics).toEqual([]);
  });

  it('reads the config in a folder a script names, once, and skips a config that is missing or a folder without one', async () => {
    const { configs, diagnostics } = await placed(
      {
        'package.json': JSON.stringify({
          devDependencies: { '@playwright/test': '1.63.0' },
          scripts: {
            e2e: 'playwright test -c config/e2e',
            'e2e:ci': 'npx playwright test --config config/e2e --retries 2',
            'e2e:staging': 'playwright test -c config/staging/playwright.config.ts',
            'e2e:reports': 'playwright test -c reports',
            nightly: 3,
          },
        }),
        'playwright.config.ts': "export default { testDir: 'tests' };\n",
        'config/e2e/playwright.config.ts': "export default { testDir: '../../e2e' };\n",
        'reports/README.md': 'Playwright writes its HTML report here.\n',
        'e2e/place-order.spec.ts': SPEC,
      },
      'playwright',
      ['e2e/**/*.spec.ts'],
    );
    expect(configs).toEqual({ 'e2e/place-order.spec.ts': 'config/e2e/playwright.config.ts' });
    expect(diagnostics).toEqual([]);
  });

  it('takes no route from a Cypress command in a folder without a config, as Cypress refuses to start there', async () => {
    const { diagnostics } = await placed(
      {
        'package.json': JSON.stringify({ devDependencies: { cypress: '15.6.0' } }),
        'cypress.config.ts': "export default { e2e: { specPattern: 'cypress/e2e/**/*.cy.ts' } };\n",
        'apps/admin/package.json': JSON.stringify({ scripts: { cy: 'cypress run' } }),
        'apps/admin/cypress/e2e/approve-account.cy.ts': GLOBAL_UNIT,
      },
      'cypress',
      ['apps/**/*.cy.ts'],
    );
    expect(diagnostics).toEqual(['file-not-run apps/admin/cypress/e2e/approve-account.cy.ts']);
  });

  it('takes the config above a package before Vitest 5, which looks in the folders above it, and its defaults from 5', async () => {
    const files = {
      'vitest.config.ts': "export default { test: { include: ['src/**/*.check.ts'] } };\n",
      'packages/quotes/package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
      'packages/quotes/src/feed.check.ts': UNIT,
    };
    const vitest4 = await placed(files, 'vitest', ['packages/**/*.ts'], '4.1.2');
    expect(vitest4.configs).toEqual({ 'packages/quotes/src/feed.check.ts': 'vitest.config.ts' });
    expect(vitest4.diagnostics).toEqual([]);
    const vitest5 = await placed(files, 'vitest', ['packages/**/*.ts'], '5.0.3');
    expect(vitest5.diagnostics).toEqual(['file-not-run packages/quotes/src/feed.check.ts']);
  });

  it('runs a package with the defaults of Vitest before 5 when no config is in its folder or above it', async () => {
    const { configs, diagnostics } = await placed(
      {
        'packages/quotes/package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
        'packages/quotes/src/legacy/vitest.config.ts': "export default { test: { include: ['**/*.spec.ts'] } };\n",
        'packages/quotes/src/legacy/tick-feed.test.ts': UNIT,
      },
      'vitest',
      ['packages/**/*.test.ts'],
      '4.1.2',
    );
    expect(configs).toEqual({ 'packages/quotes/src/legacy/tick-feed.test.ts': null });
    expect(diagnostics).toEqual([]);
  });

  it("can't tell when the files a script's config runs can't be worked out, and reports the setting", async () => {
    const { diagnostics } = await placed(
      {
        'package.json': manifest(VITEST, { 'test:live': 'vitest run -c vitest.live.config.ts' }),
        'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'] } };\n",
        'vitest.live.config.ts':
          "import { liveSuites } from './live/suites.ts';\nexport default { test: { include: liveSuites() } };\n",
        'live/suites.ts':
          "export function liveSuites() {\n  return process.env.BROKER === 'paper' ? ['live/paper/**/*.test.ts'] : ['live/**/*.test.ts'];\n}\n",
        'live/broker-fills.test.ts': UNIT,
      },
      'vitest',
      ['live/**/*.test.ts'],
    );
    expect(diagnostics).toEqual(['config-value-unknown vitest.live.config.ts']);
  });

  it("can't tell when a script names a config the scan can't read, and says so on the package.json", async () => {
    const { diagnostics, inventory } = await placed(
      {
        'package.json': manifest(VITEST, { 'test:live': 'vitest run -c $VITEST_LIVE_CONFIG' }),
        'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'] } };\n",
        'live/broker-fills.test.ts': UNIT,
      },
      'vitest',
      ['live/**/*.test.ts'],
    );
    expect(diagnostics).toEqual(['config-value-unknown package.json']);
    expect(inventory.diagnostics[0].message).toBe(
      "The script test:live in package.json starts the runner with a config or root the scan can't read without running it, so it can't tell which files that runs; files the configs it reads leave out aren't reported as not run.",
    );
  });
});
