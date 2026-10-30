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

  it.each([
    ['1.56.0', { tags: [[], ['@ui', '@fast']], projects: [['api'], ['no-api']] }],
    ['1.57.0', { tags: [['@nightly'], ['@nightly', '@ui', '@fast']], projects: [['api'], ['nightly-only']] }],
  ])("gives every test the Playwright %s config's tag, first, also for grep: %j", async (version, expected) => {
    const inventory = await scanned(
      {
        'package.json': JSON.stringify({ devDependencies: { '@playwright/test': version } }),
        'playwright.config.ts': [
          "import { defineConfig } from '@playwright/test';",
          '',
          'export default defineConfig({',
          "  testDir: 'tests',",
          "  tag: '@nightly',",
          '  projects: [',
          "    { name: 'api', testMatch: 'api/*.spec.ts' },",
          "    { name: 'no-api', testIgnore: /api/, grepInvert: /@nightly/ },",
          "    { name: 'nightly-only', testIgnore: /api/, grep: /^nightly-only watchlist\\.spec\\.ts @nightly watchlist/ },",
          '  ],',
          '});',
          '',
        ].join('\n'),
        'tests/api/quotes.spec.ts':
          "import { test } from '@playwright/test';\ntest('returns a quote for AAPL', async () => {});\n",
        'tests/watchlist.spec.ts': [
          "import { test } from '@playwright/test';",
          "test.describe('watchlist @ui', () => {",
          "  test('adds NVDA to the watchlist', { tag: '@fast' }, async () => {});",
          '});',
          '',
        ].join('\n'),
      },
      'playwright',
      ['tests/**/*.spec.ts'],
    );
    expect({
      tags: inventory.tests.map((test) => test.tags),
      projects: inventory.tests.map((test) => test.projects),
    }).toEqual(expected);
  });

  it("can't tell the projects with a grep when the Playwright config's tag can't be worked out", async () => {
    const inventory = await scanned(
      {
        'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.64.0' } }),
        'playwright.config.ts': [
          'export default {',
          "  tag: ['@regression', process.env.CI_ENVIRONMENT_NAME],",
          "  projects: [{ name: 'chromium' }, { name: 'staging', grep: /@staging/ }],",
          '};',
          '',
        ].join('\n'),
        'tests/orders.spec.ts':
          "import { test } from '@playwright/test';\ntest('places a limit order', { tag: '@smoke' }, async () => {});\n",
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(inventory.tests.map((test) => [test.tags, test.projects])).toEqual([[['@smoke'], null]]);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "The config's tag could not be worked out without running the config, so the tests' tags leave it out.",
    ]);
  });

  it.each([
    ['1.63.0', ['slow']],
    ['1.64.0', []],
  ])(
    'leaves out a Playwright %s project with default: false unless a running project depends on it',
    async (version, slow) => {
      const root = project({
        'package.json': JSON.stringify({ devDependencies: { '@playwright/test': version } }),
        'playwright.config.ts': [
          "import { defineConfig } from '@playwright/test';",
          '',
          'export default defineConfig({',
          "  testDir: './e2e',",
          '  projects: [',
          "    { name: 'setup', testMatch: /global\\.setup\\.ts/, teardown: 'cleanup', default: false },",
          "    { name: 'cleanup', testMatch: /global\\.teardown\\.ts/, default: false },",
          "    { name: 'chromium', testIgnore: /slow|global/, dependencies: ['setup'] },",
          "    { name: 'slow', testDir: './e2e/slow', default: false },",
          '  ],',
          '});',
          '',
        ].join('\n'),
        'e2e/global.setup.ts':
          "import { test as setup } from '@playwright/test';\nsetup('signs in as a trader', async () => {});\n",
        'e2e/global.teardown.ts':
          "import { test as teardown } from '@playwright/test';\nteardown('closes the open orders', async () => {});\n",
        'e2e/orders.spec.ts':
          "import { test } from '@playwright/test';\ntest('places a limit order', async () => {});\n",
        'e2e/slow/replay.spec.ts':
          "import { test } from '@playwright/test';\ntest('replays a day of quotes', async () => {});\n",
      });
      const inventory = await scan({ root, patterns: ['e2e/**/*.ts'], framework: 'playwright' });
      expect(projectsOf(inventory)).toEqual({
        'signs in as a trader': ['setup'],
        'closes the open orders': ['cleanup'],
        'places a limit order': ['chromium'],
        'replays a day of quotes': slow,
      });
      expect(inventory.configs[0].projects?.map((item) => item.name)).toEqual(['setup', 'cleanup', 'chromium', 'slow']);
    },
  );

  it("can't tell which Playwright projects run a test when a project's default can't be worked out", async () => {
    const inventory = await scanned(
      {
        'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.64.0' } }),
        'playwright.config.ts': [
          'export default {',
          '  projects: [',
          "    { name: 'chromium', grep: /@smoke/ },",
          "    { name: 'seed', testMatch: /seed\\.setup\\.ts/, default: false },",
          "    { name: 'nightly', dependencies: ['seed'], default: !!process.env.NIGHTLY },",
          "    { name: 'nightly-webkit', dependencies: ['seed'], default: !!process.env.NIGHTLY },",
          '  ],',
          '};',
          '',
        ].join('\n'),
        'tests/orders.spec.ts':
          "import { test } from '@playwright/test';\ntest('places a limit order @smoke', async () => {});\ntest('cancels an order', async () => {});\n",
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(projectsOf(inventory)).toEqual({ 'places a limit order @smoke': null, 'cancels an order': null });
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "The config's projects default could not be worked out without running the config, so the scan can't tell which projects run the tests.",
      "The config's projects default could not be worked out without running the config, so the scan can't tell which projects run the tests.",
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
      'caches a quote': ['quotes'],
      'charges the minimum fee': ['unit', 'node', 'browser (chromium)', 'safari'],
      'reads the feed': ['node'],
      'signs in': ['3 (firefox)'],
    });
    expect(
      inventory.configs.map((config) => [config.relativeFilePath, config.projects?.map((item) => item.name)]),
    ).toEqual([
      ['packages/quotes/vitest.config.ts', ['']],
      ['vitest.config.ts', ['unit', 'node', 'browser (chromium)', 'safari', '3 (firefox)', 'quotes']],
    ]);
  });

  it.each(['3.2.0', '4.1.0', '5.0.3'])(
    'names an unnamed Vitest %s project after its package.json name, else its folder, or an inline one after its index',
    async (version) => {
      const root = project({
        'package.json': JSON.stringify({ name: 'trading', devDependencies: { vitest: version } }),
        'vitest.config.ts': [
          'export default {',
          '  test: {',
          '    projects: [',
          "      'packages/*',",
          "      { test: { include: ['tests/**/*.test.ts'] } },",
          "      { test: { name: 'node', include: ['tests/**/*.test.ts'] } },",
          "      { test: { name: { label: '' }, include: ['tests/**/*.test.ts'] } },",
          '    ],',
          '  },',
          '};',
          '',
        ].join('\n'),
        'tests/fees.test.ts': "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n",
        'packages/pricing/package.json': JSON.stringify({ name: '@trading/pricing' }),
        'packages/pricing/src/spread.test.ts': "import { test } from 'vitest';\ntest('quotes the spread', () => {});\n",
        'packages/risk/package.json': JSON.stringify({ name: '@trading/risk' }),
        'packages/risk/vitest.config.ts': "export default { test: { include: ['test/**/*.test.ts'] } };\n",
        'packages/risk/test/limits.test.ts':
          "import { test } from 'vitest';\ntest('blocks an order over the limit', () => {});\n",
        'packages/ledger/package.json': JSON.stringify({ private: true }),
        'packages/ledger/src/balance.test.ts': "import { test } from 'vitest';\ntest('settles a trade', () => {});\n",
        'packages/quotes/src/cache.test.ts': "import { test } from 'vitest';\ntest('caches a quote', () => {});\n",
      });
      const inventory = await scan({ root, framework: 'vitest' });
      expect(projectsOf(inventory)).toEqual({
        'charges the minimum fee': ['0', 'node', '2'],
        'quotes the spread': ['@trading/pricing'],
        'blocks an order over the limit': ['@trading/risk'],
        'settles a trade': ['ledger'],
        'caches a quote': ['quotes'],
      });
    },
  );

  it.each([
    ['4.1.0', ['desk', 'shared']],
    ['5.0.3', ['0', '1']],
  ])(
    'names an inline Vitest %s project that extends a named config %j, as only Vitest 5 drops the name',
    async (version, expected) => {
      const root = project({
        'package.json': JSON.stringify({ name: 'trading', devDependencies: { vitest: version } }),
        'vitest.shared.ts': "export default { test: { name: 'shared' } };\n",
        'vitest.config.ts': [
          'export default {',
          '  test: {',
          "    name: 'desk',",
          '    projects: [',
          "      { extends: true, test: { include: ['tests/**/*.test.ts'] } },",
          "      { extends: './vitest.shared.ts', test: { include: ['tests/**/*.test.ts'] } },",
          '    ],',
          '  },',
          '};',
          '',
        ].join('\n'),
        'tests/book.test.ts': "import { test } from 'vitest';\ntest('books a trade', () => {});\n",
      });
      const inventory = await scan({ root, framework: 'vitest' });
      expect(projectsOf(inventory)).toEqual({ 'books a trade': expected });
    },
  );

  it.each([
    [
      '4.1.0',
      {
        'books a trade': ['@trading/desk'],
        'reconciles the desk': ['0'],
        'renders the blotter': ['web'],
        'clicks buy': ['web'],
        'opens the order ticket': ['web'],
      },
    ],
    [
      '5.0.3',
      {
        'books a trade': ['@trading/desk', '@trading/desk (0)'],
        'reconciles the desk': ['@trading/desk (0)'],
        'renders the blotter': ['web (unit)'],
        'clicks buy': ['web (1)'],
        'opens the order ticket': ['web (e2e) (smoke)'],
      },
    ],
  ])(
    'names the projects of a config another lists after that config in Vitest 5 only: %s',
    async (version, expected) => {
      const unit = (title: string) => `import { test } from 'vitest';\ntest('${title}', () => {});\n`;
      const root = project({
        'package.json': JSON.stringify({ name: 'trading', devDependencies: { vitest: version } }),
        'vitest.config.ts': "export default { test: { projects: ['apps/*'] } };\n",
        'apps/web/vitest.config.ts': [
          'export default {',
          '  test: {',
          "    name: 'web',",
          '    projects: [',
          "      { test: { name: 'unit', include: ['src/**/*.unit.test.ts'] } },",
          "      { test: { include: ['src/**/*.dom.test.ts'] } },",
          "      'e2e',",
          '    ],',
          '  },',
          '};',
          '',
        ].join('\n'),
        'apps/web/e2e/vitest.config.ts':
          "export default { test: { projects: [{ test: { name: 'smoke', include: ['specs/**/*.test.ts'] } }] } };\n",
        'apps/web/src/blotter.unit.test.ts': unit('renders the blotter'),
        'apps/web/src/ticket.dom.test.ts': unit('clicks buy'),
        'apps/web/e2e/specs/ticket.test.ts': unit('opens the order ticket'),
        'apps/desk/package.json': JSON.stringify({ name: '@trading/desk' }),
        'apps/desk/vitest.config.ts': [
          'export default {',
          '  test: {',
          "    include: ['src/**/*.test.ts'],",
          "    projects: ['./vitest.config.ts', { test: { include: ['test/**/*.test.ts'] } }],",
          '  },',
          '};',
          '',
        ].join('\n'),
        'apps/desk/src/book.test.ts': unit('books a trade'),
        'apps/desk/test/recon.test.ts': unit('reconciles the desk'),
      });
      const inventory = await scan({ root, framework: 'vitest' });
      expect(projectsOf(inventory)).toEqual(expected);
    },
  );

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
