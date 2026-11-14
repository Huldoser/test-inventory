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
