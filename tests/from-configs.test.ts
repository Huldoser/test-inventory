import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan } from '../src/index.ts';
import { EXAMPLES, fixtures, readGolden } from './examples.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

const SPEC = "import { test } from '@playwright/test';\ntest('places a market order', async () => {});\n";
const UNIT = "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n";

describe('a scan without patterns', () => {
  it('retains candidate files from readable Playwright settings when a loop builds the projects', async () => {
    const root = project({
      'package.json': JSON.stringify({
        devDependencies: { '@playwright/test': '1.63.0' },
        scripts: { test: 'playwright test --config tests/library/playwright.config.ts' },
      }),
      'tests/library/playwright.config.ts': [
        "import path from 'node:path';",
        "const config = { testDir: path.join(__dirname, '..'), testIgnore: '**/drafts/**', projects: [] };",
        "for (const browserName of ['chromium', 'webkit']) {",
        "  config.projects.push({ name: browserName, testDir: path.join(config.testDir, 'page') });",
        '}',
        'export default config;',
      ].join('\n'),
      'tests/library/orders.spec.ts': SPEC,
      'tests/page/quotes.spec.ts': SPEC,
      'tests/page/drafts/quotes.spec.ts': SPEC,
      'tests/page/orderHelpers.ts': SPEC,
      'unrelated/positions.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.projects])).toEqual([
      ['tests/library/orders.spec.ts', null],
      ['tests/page/quotes.spec.ts', null],
    ]);
    expect(inventory.files.map((file) => file.config)).toEqual([
      'tests/library/playwright.config.ts',
      'tests/library/playwright.config.ts',
    ]);
    expect(inventory.configs[0].projects).toBeNull();
    expect(inventory.diagnostics).toMatchObject([
      { code: 'config-value-unknown', level: 'error', relativeFilePath: 'tests/library/playwright.config.ts' },
    ]);
    expect(inventory.diagnostics).toHaveLength(1);
    expect(inventory.diagnostics[0].message).toContain('candidate files');
    expect(inventory.diagnostics[0].message).toContain('may be missing');
  });

  it('does not fall back to Playwright candidates when the projects are known to be empty', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'playwright.config.ts': "export default { testDir: 'tests', projects: [] };\n",
      'tests/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['no-files-matched']);
  });

  it('discovers default Playwright specs in the package that runs playwright test', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'apps/trader/package.json': JSON.stringify({ scripts: { test: 'playwright test' } }),
      'apps/trader/orders.spec.ts': SPEC,
      'apps/trader/market-data.ts': SPEC,
      'apps/trader/.gitignore': 'archive/\n',
      'apps/trader/archive/fees.spec.ts': SPEC,
      'apps/quotes/package.json': JSON.stringify({ scripts: { test: 'playwright test --config missing.ts' } }),
      'apps/quotes/quotes.spec.ts': SPEC,
      'apps/positions/package.json': JSON.stringify({ scripts: { test: 'playwright test margin' } }),
      'apps/positions/risk.spec.ts': SPEC,
      'portfolio.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.files.map((file) => [file.relativeFilePath, file.config])).toEqual([
      ['apps/trader/orders.spec.ts', null],
    ]);
    expect(inventory.tests.map((test) => test.title)).toEqual(['places a market order']);
    expect(inventory.configs).toEqual([]);
  });

  it('discovers Playwright files through a package script whose config is outside their ancestors', async () => {
    const root = project({
      'package.json': JSON.stringify({
        devDependencies: { '@playwright/test': '1.63.0' },
        scripts: { test: 'playwright test --config configs/browser.ts' },
      }),
      'configs/browser.ts': "export default { testDir: '../e2e', testMatch: '**/*.browser.ts' };\n",
      'e2e/orders.browser.ts': SPEC,
      'e2e/quotes.spec.ts': SPEC,
      'tests/orders.browser.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.projects])).toEqual([
      ['e2e/orders.browser.ts', ['']],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('asks for patterns when top-level Playwright file filters cannot select candidates', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'playwright.config.ts': 'export default { testDir: process.env.E2E_DIR, projects: buildBrowserProjects() };\n',
      'tests/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics).toMatchObject([
      { code: 'config-value-unknown', level: 'error' },
      { code: 'no-files-matched' },
    ]);
    expect(inventory.diagnostics[0].message).toContain('give patterns');
  });

  it.each(EXAMPLES)(
    'finds the tests of $name from its configs, as the golden scan with patterns does',
    async ({ name, framework }) => {
      const inventory = await scan({ root: path.join(fixtures, name), framework });
      const golden = readGolden(name);
      expect(inventory.tests).toEqual(golden.tests);
      expect(inventory.suites).toEqual(golden.suites);
      expect(inventory.configs).toEqual(golden.configs);
    },
  );

  it('scans only the files a config runs, in every folder under the root', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': "export default { test: { include: ['tests/**/*.test.ts'] } };\n",
      'tests/fees.test.ts': UNIT,
      'src/fees.ts': 'export const fee = 1;\n',
      'scripts/replay.test.ts': UNIT,
      'packages/quotes/vitest.config.ts': 'export default {};\n',
      'packages/quotes/src/feed.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.files.map((file) => [file.relativeFilePath, file.config])).toEqual([
      ['packages/quotes/src/feed.test.ts', 'packages/quotes/vitest.config.ts'],
      ['tests/fees.test.ts', 'vitest.config.ts'],
    ]);
    expect(inventory.summary.fileCount).toBe(2);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('says to give patterns for a config whose files it cannot work out', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'playwright.config.ts': "import { e2e } from '@trading/e2e-config';\nexport default e2e;\n",
      'tests/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message])).toEqual([
      [
        'config-value-unknown',
        "The config's projects could not be worked out without running the config, so the scan can't tell which files it runs; give patterns to scan them.",
      ],
      ['no-files-matched', 'No test files were found from the configs in the root.'],
    ]);
  });

  it.each([
    ['playwright', 'Playwright', PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts', SPEC],
    ['vitest', 'Vitest', VITEST_PACKAGE, 'tests/fees.test.ts', UNIT],
  ] as const)(
    'says when there is no %s config to find the tests from',
    async (framework, name, manifest, file, code) => {
      const root = project({ 'package.json': manifest, [file]: code });
      const inventory = await scan({ root, framework });
      expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
        `No patterns were given, and no ${name} config is in the root or a folder below it, so there are no test files to find.`,
      ]);
    },
  );
});

describe('a Vitest browser config whose browser comes from the environment', () => {
  it('lists the files the config runs, without saying which browser project runs them', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': [
        "const browser = process.env.CHART_BROWSER || 'chromium';",
        "export default { test: { include: ['spec/**/*.spec.ts'], browser: { enabled: true, instances: [{ browser }] } } };",
      ].join('\n'),
      'spec/candles.spec.ts': UNIT,
      'src/candles.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(['spec/candles.spec.ts']);
    expect(inventory.tests.map((test) => test.projects)).toEqual([null]);
    expect(inventory.diagnostics.map((item) => [item.code, item.level, item.message])).toEqual([
      [
        'config-value-unknown',
        'warning',
        "The config's test.browser.instances could not be worked out without running the config, so the scan lists the files the config runs, but not which of its browser projects run them.",
      ],
    ]);
  });

  it('lists the files the config runs when the environment turns browser mode on', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts':
        "export default { test: { include: ['spec/**/*.spec.ts'], browser: { enabled: process.env.CHART_BROWSER === '1', instances: [{ browser: 'chromium' }] } } };\n",
      'spec/candles.spec.ts': UNIT,
      'src/candles.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(['spec/candles.spec.ts']);
    expect(inventory.tests.map((test) => test.projects)).toEqual([null]);
    expect(inventory.diagnostics.map((item) => [item.code, item.level, item.message])).toEqual([
      [
        'config-value-unknown',
        'warning',
        "The config's test.browser.enabled could not be worked out without running the config, so the scan lists the files the config runs, but not which of its browser projects run them.",
      ],
    ]);
  });
});

describe('a Vitest config whose projects or file settings come from code the scan does not run', () => {
  const CANDIDATES =
    "The config's test.projects could not be worked out without running the config, so the scan lists candidate files from the readable top-level file settings; project membership is unknown and tests may be missing; give patterns to select other files.";

  it.each([
    [
      'a list built from the folders',
      VITEST_PACKAGE,
      [
        "import { readdirSync } from 'node:fs';",
        "const lanes = readdirSync('src').map((lane) => ({ extends: true, test: { name: lane, include: [`src/${lane}/**/*.test.ts`] } }));",
        "export default { test: { exclude: ['src/legacy/**'], projects: lanes } };",
      ].join('\n'),
    ],
    [
      'an entry that is a function',
      VITEST_PACKAGE,
      "export default { test: { exclude: ['src/legacy/**'], projects: [() => ({ test: { name: 'settlement' } })] } };\n",
    ],
    [
      'Vitest 3 test.workspace',
      JSON.stringify({ devDependencies: { vitest: '3.2.4' } }),
      "export default { test: { exclude: ['src/legacy/**'], workspace: process.env.CI ? ['packages/*'] : ['src'] } };\n",
    ],
  ])('keeps the files its own settings select as candidates, with %s', async (_, manifest, config) => {
    const root = project({
      'package.json': manifest,
      'vitest.config.ts': config,
      'src/pricing/fees.test.ts': UNIT,
      'src/settlement/netting.test.ts': UNIT,
      'src/legacy/ledger.test.ts': UNIT,
      'src/pricing/fees.ts': 'export const fee = 1;\n',
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.files.map((file) => [file.relativeFilePath, file.config])).toEqual([
      ['src/pricing/fees.test.ts', 'vitest.config.ts'],
      ['src/settlement/netting.test.ts', 'vitest.config.ts'],
    ]);
    expect(inventory.tests.map((test) => test.projects)).toEqual([null, null]);
    const key = manifest === VITEST_PACKAGE ? 'test.projects' : 'test.workspace';
    expect(inventory.diagnostics.map((item) => [item.code, item.level, item.message])).toEqual([
      ['config-value-unknown', 'error', CANDIDATES.replace('test.projects', key)],
    ]);
  });

  it('reads a Vitest 3 config that sets test.workspace to undefined as one without a workspace', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { vitest: '3.2.4' } }),
      'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'], workspace: undefined } };\n",
      'src/pricing/fees.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.projects])).toEqual([
      ['src/pricing/fees.test.ts', ['']],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('keeps no candidates for a Vitest 3 test.workspace from mergeConfig, as the error would have no place', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { vitest: '3.2.4' } }),
      'vitest.config.ts': [
        "import { defineConfig, mergeConfig } from 'vitest/config';",
        'const shared = { test: { globals: true } };',
        "export default mergeConfig(shared, defineConfig({ test: { workspace: ['packages/*'] } }));",
      ].join('\n'),
      'packages/pricing/src/fees.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics.map((item) => item.code)).toEqual(['no-files-matched']);
  });

  it('places a file in the project it can read before taking it as a candidate', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': [
        'export default {',
        '  test: {',
        "    projects: [{ test: { name: 'pricing', include: ['src/pricing/**/*.test.ts'] } }, () => ({ test: { name: 'settlement' } })],",
        '  },',
        '};',
      ].join('\n'),
      'src/pricing/fees.test.ts': UNIT,
      'src/settlement/netting.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.projects])).toEqual([
      ['src/pricing/fees.test.ts', ['pricing']],
      ['src/settlement/netting.test.ts', null],
    ]);
    expect(inventory.diagnostics.map((item) => [item.code, item.level])).toEqual([['config-value-unknown', 'error']]);
  });

  it('keeps the candidates of a config a package.json script names', async () => {
    const root = project({
      'package.json': JSON.stringify({
        devDependencies: { vitest: '5.0.3' },
        scripts: { 'test:settlement': 'vitest run --config configs/settlement.ts' },
      }),
      'configs/settlement.ts':
        "export default { test: { include: ['src/**/*.check.ts'], projects: await settlementLanes() } };\n",
      'src/netting.check.ts': UNIT,
      'src/netting.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.files.map((file) => [file.relativeFilePath, file.config])).toEqual([
      ['src/netting.check.ts', 'configs/settlement.ts'],
    ]);
    expect(inventory.diagnostics.map((item) => [item.code, item.level, item.message])).toEqual([
      ['config-value-unknown', 'error', CANDIDATES],
    ]);
  });

  it('asks for patterns, as an error, when the include itself comes from code', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts':
        "import { selectSuites } from './vitest.suites';\nexport default { test: { include: selectSuites(__dirname) } };\n",
      'vitest.suites.ts':
        "import { readdirSync } from 'node:fs';\nexport const selectSuites = (root) => readdirSync(root);\n",
      'src/fees.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics.map((item) => [item.code, item.level, item.message])).toEqual([
      [
        'config-value-unknown',
        'error',
        "The config's test.include could not be worked out without running the config, so the scan can't tell which files it runs; give patterns to scan them.",
      ],
      ['no-files-matched', 'warning', 'No test files were found from the configs in the root.'],
    ]);
  });

  it('leaves out the files the exclude entries it can read name, beside a spread it cannot', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': [
        "import { generatedSuites } from './scripts/generated-suites.mjs';",
        "export default { test: { include: ['tests/**/*.test.ts'], exclude: ['tests/fixtures/**', ...generatedSuites] } };",
      ].join('\n'),
      'scripts/generated-suites.mjs':
        "import { readdirSync } from 'node:fs';\nexport const generatedSuites = readdirSync('tests/generated').map((name) => `tests/generated/${name}`);\n",
      'tests/orders.test.ts': UNIT,
      'tests/fixtures/stale.test.ts': UNIT,
      'tests/generated/quotes.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual([
      'tests/generated/quotes.test.ts',
      'tests/orders.test.ts',
    ]);
    expect(inventory.diagnostics.map((item) => [item.code, item.level, item.message])).toEqual([
      [
        'config-value-unknown',
        'warning',
        "The config's test.exclude could not be worked out without running the config, so the scan may list test files that Vitest leaves out.",
      ],
    ]);
  });
});

describe('a runner that reads its config only in the root', () => {
  const E2E = "describe('orders', () => {\n  it('places a market order', () => {});\n});\n";
  it.each([
    [
      'cypress',
      'Cypress',
      { cypress: '14.5.0' },
      { 'apps/web/cypress.config.js': 'module.exports = { e2e: {} };\n', 'apps/web/cypress/e2e/orders.cy.js': E2E },
    ],
    [
      'webdriverio',
      'WebdriverIO',
      { '@wdio/cli': '9.20.0' },
      {
        'apps/web/wdio.conf.js': "exports.config = { specs: ['./test/**/*.e2e.js'] };\n",
        'apps/web/test/orders.e2e.js': E2E,
      },
    ],
    [
      'jasmine',
      'Jasmine',
      { jasmine: '5.13.0' },
      {
        'apps/web/spec/support/jasmine.json': JSON.stringify({ spec_dir: 'spec', spec_files: ['**/*[sS]pec.js'] }),
        'apps/web/spec/orders.spec.js': E2E,
      },
    ],
  ] as const)('names the folder below the root that has a %s config', async (framework, name, dependencies, files) => {
    const root = project({ 'package.json': JSON.stringify({ devDependencies: dependencies }), ...files });
    const inventory = await scan({ root, framework });
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      `No patterns were given, and no ${name} config is in the root, the only place the scan reads it from, so there are no test files to find. There is one in apps/web: scan that folder, or give patterns.`,
    ]);
  });

  it('names the nearest folder, and of those as near, the first by name', async () => {
    const config = 'module.exports = { e2e: {} };\n';
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { cypress: '14.5.0' } }),
      'apps/web/cypress.config.js': config,
      'apps/admin/cypress.config.js': config,
      'e2e/cypress.config.js': config,
      'tools/e2e/legacy/cypress.config.js': config,
    });
    const inventory = await scan({ root, framework: 'cypress' });
    expect(inventory.diagnostics[0].message).toMatch(/ There is one in e2e: scan that folder, or give patterns\.$/);
  });

  it('says there is none when no folder below the root has one either', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { cypress: '14.5.0' } }),
      'cypress/e2e/orders.cy.js': "it('places a market order', () => {});\n",
    });
    const inventory = await scan({ root, framework: 'cypress' });
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'No patterns were given, and no Cypress config is in the root, the only place the scan reads it from, so there are no test files to find.',
    ]);
  });
});

describe('a config built by a function the project writes', () => {
  it('reads a Playwright config a workspace package builds from the options it is given', async () => {
    const root = project({
      'package.json': JSON.stringify({
        private: true,
        workspaces: ['e2e/*'],
        devDependencies: { '@playwright/test': '1.63.0' },
      }),
      'e2e/shared/package.json': JSON.stringify({
        name: '@trading/e2e-shared',
        exports: { './playwright': './playwright.base.ts' },
      }),
      'e2e/shared/playwright.base.ts': [
        "import { defineConfig } from '@playwright/test';",
        'type Options = { port: number; specs?: string };',
        "export function configureE2e({ port, specs = './specs' }: Options) {",
        '  const baseURL = `http://localhost:${port}`;',
        "  return defineConfig({ testDir: specs, use: { baseURL }, projects: [{ name: 'chromium' }] });",
        '}',
      ].join('\n'),
      'e2e/web/playwright.config.ts': [
        "import { configureE2e } from '@trading/e2e-shared/playwright';",
        'export default configureE2e({ port: 3002 });',
      ].join('\n'),
      'e2e/web/specs/orders.spec.ts': SPEC,
      'e2e/web/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.files.map((file) => [file.relativeFilePath, file.config])).toEqual([
      ['e2e/web/specs/orders.spec.ts', 'e2e/web/playwright.config.ts'],
    ]);
    expect(inventory.tests.map((test) => test.projects)).toEqual([['chromium']]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('works out each call of a local function with its own arguments', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'playwright.config.ts': [
        "import { defineConfig } from '@playwright/test';",
        'function browserProject(name: string, folder = name) {',
        '  const testDir = `./specs/${folder}`;',
        '  const use = { headless: true };',
        '  use.headless = !process.env.HEADED;',
        '  return { name, testDir, use };',
        '}',
        'export default defineConfig({',
        "  projects: [browserProject('desktop'), browserProject('mobile', 'mobile')],",
        '});',
      ].join('\n'),
      'specs/desktop/orders.spec.ts': SPEC,
      'specs/mobile/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.projects])).toEqual([
      ['specs/desktop/orders.spec.ts', ['desktop']],
      ['specs/mobile/orders.spec.ts', ['mobile']],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads a Vitest config a local function builds from an argument', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': [
        "import { defineConfig } from 'vitest/config';",
        'const suite = (folder: string) => defineConfig({ test: { include: [`${folder}/**/*.test.ts`] } });',
        "export default suite('pricing');",
      ].join('\n'),
      'pricing/fees.test.ts': UNIT,
      'settlement/fees.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(['pricing/fees.test.ts']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads a Jest config a shared CommonJS module builds over its defaults', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { jest: '30.2.0' } }),
      'config/jest.base.config.js': [
        'module.exports = function buildConfig(packageDirectory, overrides, environment = "node") {',
        "  return { testEnvironment: environment, testRegex: '__tests__/.*\\\\.test\\\\.js$', ...overrides };",
        '};',
      ].join('\n'),
      'jest.config.js': [
        "const buildConfig = require('./config/jest.base.config');",
        "module.exports = buildConfig(__dirname, { testRegex: 'specs/.*\\\\.test\\\\.js$' });",
      ].join('\n'),
      'specs/fill.test.js': "test('fills a limit order at the limit price', () => {});\n",
      '__tests__/legacy.test.js': "test('fills a legacy order', () => {});\n",
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(['specs/fill.test.js']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it.each([
    ['a function declaration', 'export function e2eConfig(folder) { return { testDir: folder }; }', '{ e2eConfig }'],
    ['an arrow function constant', 'export const e2eConfig = (folder) => ({ testDir: folder });', '{ e2eConfig }'],
    ['the default function', 'export default function (folder) { return { testDir: folder }; }', 'e2eConfig'],
    [
      'a default export by name',
      'function build(folder) { return { testDir: folder }; }\nexport default build;',
      'e2eConfig',
    ],
    [
      'an export under another name',
      'function build(folder) { return { testDir: folder }; }\nexport { build as e2eConfig };',
      '{ e2eConfig }',
    ],
    ['an export passed on from another module', "export { e2eConfig } from './factory.ts';", '{ e2eConfig }'],
    ['module.exports', 'module.exports = function (folder) { return { testDir: folder }; };', 'e2eConfig'],
    [
      'a function in module.exports',
      'function e2eConfig(folder) { return { testDir: folder }; }\nmodule.exports = { e2eConfig };',
      '{ e2eConfig }',
    ],
  ])('reads a config built by a function a local module exports as %s', async (_, base, imported) => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'e2e/base.ts': base,
      'e2e/factory.ts': 'export function e2eConfig(folder) { return { testDir: folder }; }',
      'playwright.config.ts': `import ${imported} from './e2e/base.ts';\nexport default e2eConfig('./specs');\n`,
      'specs/orders.spec.ts': SPEC,
      'tests/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(['specs/orders.spec.ts']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it.each([
    ['?? with no argument', 'folder ?? "./specs"', ''],
    ['?? with an argument', 'folder ?? "./tests"', '"./specs"'],
    ['|| with an empty argument', 'folder || "./specs"', '""'],
    ['|| with an argument', 'folder || "./tests"', '"./specs"'],
    ['&& with a true argument', 'folder && "./specs"', 'true'],
    ['&& with an empty argument', '(folder && "./tests") || "./specs"', '""'],
  ])('reads a default a config function writes with %s', async (_, testDir, argument) => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'playwright.config.ts': `function e2eConfig(folder) {\n  return { testDir: ${testDir} };\n}\nexport default e2eConfig(${argument});\n`,
      'specs/orders.spec.ts': SPEC,
      'tests/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(['specs/orders.spec.ts']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads a config a function merges with an optional argument, as a shared Vitest config does', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'shared/vitest.ts': [
        "import { defineConfig, mergeConfig } from 'vitest/config';",
        'export default function createConfig(options?: object) {',
        "  return defineConfig(mergeConfig({ test: { include: ['src/**/*.spec.ts'] } }, options ?? {}));",
        '}',
      ].join('\n'),
      'vitest.config.ts': "import createConfig from './shared/vitest.ts';\nexport default createConfig();\n",
      'src/fees.spec.ts': UNIT,
      'src/fees.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(['src/fees.spec.ts']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it.each([
    ['an installed package', "import { createConfig } from '@trading/e2e-config';", 'createConfig({ port: 3002 })'],
    ['no declaration', '', 'createConfig()'],
    ['a constant that is not a function', 'const createConfig = presets.e2e;', 'createConfig()'],
    ['a function the module does not export', "import { createConfig } from './e2e/base.ts';", 'createConfig()'],
    ['a default export that is not a function', "import createConfig from './e2e/settings.ts';", 'createConfig()'],
    ['two modules that pass it on to each other', "import { createConfig } from './e2e/loop.ts';", 'createConfig()'],
    ['an async function', 'async function createConfig() { return {}; }', 'createConfig()'],
    [
      'a function with two returns',
      "function createConfig(ci) { if (ci) return {}; return { testDir: './e2e' }; }",
      'createConfig(true)',
    ],
    [
      'a function that calls itself',
      'function createConfig(depth) { return createConfig(depth + 1); }',
      'createConfig(0)',
    ],
    [
      'a spread argument',
      "function createConfig(folder) { return { testDir: folder }; }\nconst folders = ['./e2e'];",
      'createConfig(...folders)',
    ],
    [
      'a function that changes its parameter',
      "function createConfig(folder) { folder += '/e2e'; return { testDir: folder }; }",
      "createConfig('.')",
    ],
    [
      'a rest parameter',
      'function createConfig({ ...options }) { return { testDir: options.folder }; }',
      "createConfig({ folder: './e2e' })",
    ],
    ['a list parameter', 'function createConfig([folder]) { return { testDir: folder }; }', "createConfig(['./e2e'])"],
    ['a method', 'const presets = { e2e: () => ({}) };', 'presets.e2e()'],
    [
      'a default the environment can replace',
      'function createConfig() { return { testDir: process.env.SPECS ?? "./e2e" }; }',
      'createConfig()',
    ],
  ])('leaves a config built by %s unknown', async (_, declaration, call) => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'e2e/base.ts': 'export const port = 3002;',
      'e2e/settings.ts': "export default { testDir: './e2e' };",
      'e2e/loop.ts': "export { createConfig } from './cycle.ts';",
      'e2e/cycle.ts': "export { createConfig } from './loop.ts';",
      'playwright.config.ts': `${declaration}\nexport default ${call};\n`,
      'tests/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.code)).toContain('config-value-unknown');
    expect(inventory.files).toEqual([]);
  });
});
