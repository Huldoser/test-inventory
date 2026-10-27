import { describe, expect, it } from 'vitest';
import { scan, type Framework, type Inventory } from '../src/index.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

async function scanned(files: Record<string, string>, framework: Framework, patterns: string[]): Promise<Inventory> {
  const manifest = framework === 'vitest' ? VITEST_PACKAGE : PLAYWRIGHT_PACKAGE;
  return scan({ root: project({ 'package.json': manifest, ...files }), patterns, framework });
}

function projectsOf(inventory: Inventory): Record<string, string[] | null> {
  return Object.fromEntries(inventory.tests.map((test) => [test.fullName, test.projects]));
}

describe('which projects run each test', () => {
  it('lists the Playwright projects that run a test, after their testDir, grep and grepInvert', async () => {
    const inventory = await scanned(
      {
        'playwright.config.ts': [
          'export default {',
          '  grepInvert: /@flaky/,',
          '  projects: [',
          "    { name: 'desktop' },",
          "    { name: 'smoke', grep: [/@smoke/, /quotes streams/] },",
          "    { name: 'api', testDir: './tests/api' },",
          "    { name: 'mobile', grep: /checkout/, grepInvert: /@slow/, dependencies: ['desktop'] },",
          '  ],',
          '};',
          '',
        ].join('\n'),
        'tests/orders.spec.ts': [
          "import { test } from '@playwright/test';",
          "test('places a market order @smoke', async () => {});",
          "test('checkout pays by card', { tag: '@slow' }, async () => {});",
          "test('refunds a fill @flaky', async () => {});",
          "test.describe('quotes', () => {",
          "  test('streams a price', async () => {});",
          '});',
          '',
        ].join('\n'),
        'tests/api/fills.spec.ts': "import { test } from '@playwright/test';\ntest('lists fills', async () => {});\n",
      },
      'playwright',
      ['tests/**/*.spec.ts'],
    );
    expect(projectsOf(inventory)).toEqual({
      'lists fills': ['desktop', 'api'],
      'places a market order @smoke': ['desktop', 'smoke'],
      'checkout pays by card': ['desktop'],
      'refunds a fill @flaky': [],
      'quotes > streams a price': ['desktop', 'smoke'],
    });
    expect(inventory.configs[0].projects).toEqual([
      { name: 'desktop', testDir: '.', dependencies: [] },
      { name: 'smoke', testDir: '.', dependencies: [] },
      { name: 'api', testDir: 'tests/api', dependencies: [] },
      { name: 'mobile', testDir: '.', dependencies: ['desktop'] },
    ]);
  });

  it("names a Playwright config without projects after its name, and can't tell for a dynamic title under grep", async () => {
    const plain = await scanned(
      {
        'playwright.config.ts': "export default { name: 'web', testDir: './tests' };\n",
        'tests/orders.spec.ts':
          "import { test } from '@playwright/test';\ntest('places a market order', async () => {});\n",
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(projectsOf(plain)).toEqual({ 'places a market order': ['web'] });
    expect(plain.configs[0].projects).toEqual([{ name: 'web', testDir: 'tests', dependencies: [] }]);
    const dynamic = await scanned(
      {
        'playwright.config.ts': 'export default { grep: /@smoke/ };\n',
        'tests/orders.spec.ts':
          "import { test } from '@playwright/test';\nimport { SYMBOL } from './symbols';\ntest(`quotes ${SYMBOL}`, async () => {});\n",
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(projectsOf(dynamic)).toEqual({ '`quotes ${SYMBOL}`': null });
  });

  it('lists the Vitest projects that run a test: inline projects, config files and browser instances', async () => {
    const inventory = await scanned(
      {
        'vitest.config.ts': [
          'export default {',
          '  test: {',
          '    projects: [',
          "      { test: { name: 'unit', include: ['tests/**/*.test.ts'] } },",
          "      { test: { name: { label: 'node' }, include: ['tests/**/*.test.ts', 'tests/**/*.node.ts'] } },",
          "      { test: { name: 'browser', include: ['tests/**/*.test.ts'], browser: { enabled: true, instances: [{ browser: 'chromium' }, { browser: 'webkit', name: 'safari' }] } } },",
          "      { test: { include: ['tests/**/*.e2e.ts'], browser: { enabled: true, instances: [{ browser: 'firefox' }] } } },",
          "      'packages/*',",
          '    ],',
          '  },',
          '};',
          '',
        ].join('\n'),
        'tests/fees.test.ts': "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n",
        'tests/feed.node.ts': "import { test } from 'vitest';\ntest('reads the feed', () => {});\n",
        'tests/login.e2e.ts': "import { test } from 'vitest';\ntest('signs in', () => {});\n",
        'packages/quotes/vitest.config.ts': 'export default {};\n',
        'packages/quotes/src/cache.test.ts': "import { test } from 'vitest';\ntest('caches a quote', () => {});\n",
      },
      'vitest',
      ['**/*.{test,node,e2e}.ts'],
    );
    expect(projectsOf(inventory)).toEqual({
      'caches a quote': [''],
      'charges the minimum fee': ['unit', 'node', 'browser (chromium)', 'safari'],
      'reads the feed': ['node'],
      'signs in': ['firefox'],
    });
    expect(
      inventory.configs.map((config) => [config.relativeFilePath, config.projects?.map((item) => item.name)]),
    ).toEqual([
      ['packages/quotes/vitest.config.ts', ['']],
      ['vitest.config.ts', ['unit', 'node', 'browser (chromium)', 'safari', 'firefox', '']],
    ]);
  });

  it('has no projects without a config, none when no project runs the test, and null when it cannot tell', async () => {
    const none = await scanned(
      { 'tests/fees.test.ts': "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n" },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(projectsOf(none)).toEqual({ 'charges the minimum fee': null });
    const notRun = await scanned(
      {
        'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'] } };\n",
        'tests/fees.test.ts': "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n",
      },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(projectsOf(notRun)).toEqual({ 'charges the minimum fee': [] });
    const unknown = await scanned(
      {
        'vitest.config.ts': "export default { test: { projects: process.env.CI ? ['ci'] : ['local'] } };\n",
        'tests/fees.test.ts': "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n",
      },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(projectsOf(unknown)).toEqual({ 'charges the minimum fee': null });
    expect(unknown.configs[0].projects).toBeNull();
  });

  it('takes projects it cannot work out as unknown: a grep, browser mode or instances from the environment', async () => {
    const spec = "import { test } from '@playwright/test';\ntest('places a market order', async () => {});\n";
    const unit = "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n";
    for (const [framework, config, file] of [
      [
        'playwright',
        "export default { projects: [{ name: 'smoke', grep: process.env.SMOKE ? /@smoke/ : /./ }] };\n",
        spec,
      ],
      ['playwright', "export default { projects: [{ name: 'smoke', grep: 'smoke' }] };\n", spec],
      ['vitest', 'export default { test: { browser: { enabled: !!process.env.BROWSER } } };\n', unit],
      [
        'vitest',
        "const BROWSERS = ['chromium'];\nexport default { test: { browser: { enabled: true, instances: BROWSERS.map((browser) => ({ browser })) } } };\n",
        unit,
      ],
    ] as const) {
      const name = framework === 'vitest' ? 'tests/fees.test.ts' : 'tests/orders.spec.ts';
      const inventory = await scanned({ [`${framework}.config.ts`]: config, [name]: file }, framework, ['tests/*.ts']);
      expect(inventory.tests.map((test) => test.projects)).toEqual([null]);
      expect(inventory.configs[0].projects).toBeNull();
    }
  });

  it('names an instance without a browser after its name, and lists the dependencies it can read', async () => {
    const vitest = await scanned(
      {
        'vitest.config.ts':
          "export default { test: { browser: { enabled: true, instances: [{ name: 'mobile' }] } } };\n",
        'tests/fees.test.ts': "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n",
      },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(projectsOf(vitest)).toEqual({ 'charges the minimum fee': ['mobile'] });
    const playwright = await scanned(
      {
        'playwright.config.ts':
          "export default { projects: [{ name: 'checkout', dependencies: ['setup', process.env.EXTRA] }] };\n",
        'tests/orders.spec.ts': [
          "import { test } from '@playwright/test';",
          "import { DESK } from './desks';",
          'test.describe(`${DESK} desk`, () => {',
          "  test('places a market order', async () => {});",
          '});',
          '',
        ].join('\n'),
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(playwright.configs[0].projects).toEqual([{ name: 'checkout', testDir: '.', dependencies: ['setup'] }]);
    expect(projectsOf(playwright)).toEqual({ '`${DESK} desk` > places a market order': ['checkout'] });
    const grepped = await scanned(
      {
        'playwright.config.ts': 'export default { grep: /desk/ };\n',
        'tests/orders.spec.ts': [
          "import { test } from '@playwright/test';",
          "import { DESK } from './desks';",
          'test.describe(`${DESK} desk`, () => {',
          "  test('places a market order', async () => {});",
          '});',
          '',
        ].join('\n'),
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(projectsOf(grepped)).toEqual({ '`${DESK} desk` > places a market order': null });
  });
});
