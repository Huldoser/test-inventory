import { describe, expect, it } from 'vitest';
import { scan, type Framework, type Inventory, type TestRecord } from '../src/index.ts';
import { PLAYWRIGHT_IMPORT, scanPlaywright, scanVitest, testNamed, VITEST_IMPORT } from './helpers.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

async function scanned(files: Record<string, string>, framework: Framework, patterns: string[]): Promise<Inventory> {
  const manifest = framework === 'vitest' ? VITEST_PACKAGE : PLAYWRIGHT_PACKAGE;
  return scan({ root: project({ 'package.json': manifest, ...files }), patterns, framework });
}

const sources = (test: TestRecord) => ({
  timeout: [test.timeout, test.timeoutSource],
  retries: [test.retries, test.retriesSource],
  repeats: [test.repeats, test.repeatsSource],
});

describe('where run settings come from', () => {
  it('says which place in the file sets each run setting', () => {
    const playwright = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.setTimeout(45_000);
test.describe('market data', () => {
  test.describe.configure({ retries: 2 });
  test.beforeEach(async () => {
    test.setTimeout(60_000);
  });
  test('streams quotes', async () => {});
});
test('shows the watchlist', async () => {
  test.setTimeout(10_000);
});
test('lists alerts', async () => {});
`);
    expect(sources(testNamed(playwright, 'streams quotes'))).toEqual({
      timeout: [60_000, 'suite'],
      retries: [2, 'suite'],
      repeats: [null, null],
    });
    expect(sources(testNamed(playwright, 'shows the watchlist'))).toEqual({
      timeout: [10_000, 'test'],
      retries: [null, null],
      repeats: [null, null],
    });
    expect(sources(testNamed(playwright, 'lists alerts'))).toEqual({
      timeout: [45_000, 'file'],
      retries: [null, null],
      repeats: [null, null],
    });
    const vitest = scanVitest(`${VITEST_IMPORT}
describe('broker', { retry: 3 }, () => {
  test('reconnects', { timeout: 5_000, repeats: 2 }, () => {});
});
`);
    expect(sources(vitest.tests[0])).toEqual({ timeout: [5_000, 'test'], retries: [3, 'suite'], repeats: [2, 'test'] });
  });
});

describe('run settings from the config', () => {
  const SPEC = "import { test } from '@playwright/test';\ntest('places a market order', async () => {});\n";
  const UNIT = "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n";

  it("takes Playwright's timeout, retries and repeatEach from the config when the file sets none", async () => {
    const inventory = await scanned(
      {
        'playwright.config.ts':
          "export default { timeout: 20_000, retries: 1, projects: [{ name: 'desktop', repeatEach: 3 }] };\n",
        'tests/orders.spec.ts': SPEC,
        'tests/fills.spec.ts':
          "import { test } from '@playwright/test';\ntest('fills an order', async () => {\n  test.setTimeout(5_000);\n});\n",
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(sources(testNamed(inventory, 'places a market order'))).toEqual({
      timeout: [20_000, 'config'],
      retries: [1, 'config'],
      repeats: [2, 'config'],
    });
    expect(sources(testNamed(inventory, 'fills an order')).timeout).toEqual([5_000, 'test']);
  });

  it("takes Vitest's testTimeout and retry, also as an object, from the config", async () => {
    const inventory = await scanned(
      {
        'vitest.config.ts':
          'export default { test: { testTimeout: 10_000, retry: { count: 2, delay: 500, condition: /ECONNRESET/ } } };\n',
        'tests/fees.test.ts': UNIT,
      },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(inventory.tests[0]).toMatchObject({
      timeout: 10_000,
      timeoutSource: 'config',
      retries: 2,
      retryDelay: 500,
      retryCondition: '/ECONNRESET/',
      retriesSource: 'config',
    });
    const byError = await scanned(
      {
        'vitest.config.ts':
          "export default { test: { retry: { count: 1, condition: (error) => error.message.includes('ECONNRESET') } } };\n",
        'tests/fees.test.ts': UNIT,
      },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(byError.tests[0]).toMatchObject({
      retries: 1,
      retryDelay: null,
      retryCondition: "(error) => error.message.includes('ECONNRESET')",
    });
    const plain = await scanned(
      { 'vitest.config.ts': 'export default { test: { retry: { count: 3 } } };\n', 'tests/fees.test.ts': UNIT },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(plain.tests[0]).toMatchObject({ retries: 3, retryDelay: null, retryCondition: null });
    const delayOnly = await scanned(
      { 'vitest.config.ts': 'export default { test: { retry: { delay: 500 } } };\n', 'tests/fees.test.ts': UNIT },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(delayOnly.tests[0]).toMatchObject({ retries: 0, retryDelay: 500, retriesSource: 'config' });
    const fromEnv = await scanned(
      {
        'vitest.config.ts': 'export default { test: { retry: { count: Number(process.env.RETRIES), delay: 500 } } };\n',
        'tests/fees.test.ts': UNIT,
      },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(fromEnv.tests[0]).toMatchObject({ retries: null, retryDelay: null, retriesSource: 'config' });
  });

  it('has no retries, from the config, for a retry object before Vitest 4.1, which reads only a count', async () => {
    const inventory = await scan({
      root: project({
        'package.json': JSON.stringify({ devDependencies: { vitest: '4.0.0' } }),
        'vitest.config.ts': 'export default { test: { retry: { count: 2 } } };\n',
        'tests/fees.test.ts': UNIT,
      }),
      patterns: ['tests/*.test.ts'],
      framework: 'vitest',
    });
    expect(sources(inventory.tests[0]).retries).toEqual([null, 'config']);
  });

  it("takes Vitest's repeats from the config from Vitest 5, which added it", async () => {
    const files = {
      'vitest.config.ts': 'export default { test: { repeats: 2 } };\n',
      'tests/fees.test.ts': UNIT,
    };
    const latest = await scanned(files, 'vitest', ['tests/*.test.ts']);
    expect(sources(latest.tests[0]).repeats).toEqual([2, 'config']);
    const before = await scan({
      root: project({ 'package.json': JSON.stringify({ devDependencies: { vitest: '4.1.12' } }), ...files }),
      patterns: ['tests/*.test.ts'],
      framework: 'vitest',
    });
    expect(sources(before.tests[0]).repeats).toEqual([null, null]);
  });

  it('has no value, from the config, when its projects disagree or it depends on a condition', async () => {
    const inventory = await scanned(
      {
        'playwright.config.ts': [
          'export default {',
          '  retries: process.env.CI ? 2 : 0,',
          "  repeatEach: Number(process.env.REPEAT_EACH ?? '1'),",
          "  projects: [{ name: 'desktop', timeout: 30_000 }, { name: 'mobile', timeout: 60_000 }],",
          '};',
          '',
        ].join('\n'),
        'tests/orders.spec.ts': SPEC,
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(sources(inventory.tests[0])).toEqual({
      timeout: [null, 'config'],
      retries: [null, 'config'],
      repeats: [null, 'config'],
    });
    expect(inventory.diagnostics).toEqual([]);
  });

  it('takes the run settings of the projects that run each test, after their grep', async () => {
    const inventory = await scanned(
      {
        'playwright.config.ts': [
          'export default {',
          '  projects: [',
          "    { name: 'mobile', grep: /@mobile/, retries: 3 },",
          "    { name: 'desktop', grepInvert: /@mobile/, retries: 0 },",
          '  ],',
          '};',
          '',
        ].join('\n'),
        'tests/orders.spec.ts': [
          "import { test } from '@playwright/test';",
          "test('places a market order @mobile', async () => {});",
          "test('places a limit order', async () => {});",
          '',
        ].join('\n'),
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(inventory.tests.map((test) => [test.projects, test.retries, test.retriesSource])).toEqual([
      [['mobile'], 3, 'config'],
      [['desktop'], 0, 'config'],
    ]);
  });

  it("has no values, from the config, when the scan can't read its projects, and still reads forbidOnly", async () => {
    const inventory = await scanned(
      {
        'playwright.config.ts': [
          "import { devices } from '@playwright/test';",
          "const names = ['Desktop Chrome', 'iPhone 15'];",
          'export default {',
          '  forbidOnly: true,',
          '  retries: 2,',
          '  projects: names.map((name) => ({ name, use: devices[name] })),',
          '};',
          '',
        ].join('\n'),
        'tests/orders.spec.ts':
          "import { test } from '@playwright/test';\ntest.only('places a market order', async () => {});\n",
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(sources(inventory.tests[0])).toEqual({
      timeout: [null, 'config'],
      retries: [null, 'config'],
      repeats: [null, 'config'],
    });
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'config-value-unknown',
      'forbidden-only',
    ]);
  });

  it("has no values, from the config, and no forbidden-only when the config can't be parsed", async () => {
    const inventory = await scanned(
      {
        'playwright.config.ts': "export default { forbidOnly: true,, testDir: 'tests' };\n",
        'tests/orders.spec.ts':
          "import { test } from '@playwright/test';\ntest.only('places a market order', async () => {});\n",
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(sources(inventory.tests[0]).retries).toEqual([null, 'config']);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('forbidden-only');
  });

  it('runs tests in parallel with fullyParallel or sequence.concurrent, unless the file sets the mode', async () => {
    const playwright = await scanned(
      {
        'playwright.config.ts': "export default { projects: [{ name: 'desktop', fullyParallel: true }] };\n",
        'tests/orders.spec.ts': [
          "import { test } from '@playwright/test';",
          "test('places a market order', async () => {});",
          "test.describe('checkout', () => {",
          "  test.describe.configure({ mode: 'serial' });",
          "  test('pays by card', async () => {});",
          '});',
          '',
        ].join('\n'),
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(playwright.tests.map((test) => [test.title, test.isParallel, test.isSerial])).toEqual([
      ['places a market order', true, false],
      ['pays by card', false, true],
    ]);
    const vitest = await scanned(
      {
        'vitest.config.ts': 'export default { test: { sequence: { concurrent: true } } };\n',
        'tests/fees.test.ts': [
          "import { test } from 'vitest';",
          "test('charges the minimum fee', () => {});",
          "test('charges the exchange fee', { concurrent: false }, () => {});",
          '',
        ].join('\n'),
      },
      'vitest',
      ['tests/*.test.ts'],
    );
    expect(vitest.tests.map((test) => [test.title, test.isParallel])).toEqual([
      ['charges the minimum fee', true],
      ['charges the exchange fee', false],
    ]);
  });

  it('reports a .only that forbidOnly fails, as an error, or a warning with the condition it depends on', async () => {
    const files = {
      'tests/orders.spec.ts': [
        "import { test } from '@playwright/test';",
        "test.only('places a market order', async () => {});",
        "test.describe.only('checkout', () => {",
        "  test('pays by card', async () => {});",
        '});',
        "test('lists alerts', async () => {});",
        '',
      ].join('\n'),
    };
    const always = await scanned(
      { ...files, 'playwright.config.ts': 'export default { forbidOnly: true };\n' },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(
      always.diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.level,
        diagnostic.lineStart,
        diagnostic.message,
      ]),
    ).toEqual([
      ['forbidden-only', 'error', 2, 'The config sets forbidOnly, so this .only fails the run before any test runs.'],
      ['forbidden-only', 'error', 3, 'The config sets forbidOnly, so this .only fails the run before any test runs.'],
    ]);
    const onCi = await scanned(
      { ...files, 'playwright.config.ts': 'export default { forbidOnly: !!process.env.CI };\n' },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(onCi.diagnostics.map((diagnostic) => [diagnostic.level, diagnostic.message, diagnostic.source])).toEqual([
      [
        'warning',
        'The config sets forbidOnly when !!process.env.CI, so then this .only fails the run before any test runs.',
        'test.only',
      ],
      [
        'warning',
        'The config sets forbidOnly when !!process.env.CI, so then this .only fails the run before any test runs.',
        'test.describe.only',
      ],
    ]);
    const off = await scanned(
      { ...files, 'playwright.config.ts': 'export default { forbidOnly: false };\n' },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(off.diagnostics).toEqual([]);
  });

  it('reports a .only declared in an imported helper at the call that registers it', async () => {
    const inventory = await scanned(
      {
        'playwright.config.ts': 'export default { forbidOnly: true };\n',
        'tests/support/checkout.ts': [
          "import { test } from '@playwright/test';",
          'export function checkoutTests() {',
          "  test.only('pays by card', async () => {});",
          "  test.describe.only('refunds', () => {",
          "    test('refunds a partial fill', async () => {});",
          '  });',
          '}',
          '',
        ].join('\n'),
        'tests/checkout.spec.ts': "import { checkoutTests } from './support/checkout';\n\ncheckoutTests();\n",
      },
      'playwright',
      ['tests/*.spec.ts'],
    );
    expect(
      inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.lineStart, diagnostic.source]),
    ).toEqual([
      ['forbidden-only', 3, null],
      ['forbidden-only', 3, null],
    ]);
  });
});
