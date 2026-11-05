import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { project } from './project.ts';

const MOCHA_PACKAGE = JSON.stringify({ name: 'order-service', devDependencies: { mocha: '12.0.3' } });
const TEST = "describe('orders', () => {\n  it('places a market order', () => {});\n});\n";

function files(inventory: Inventory): string[] {
  return inventory.files.map((file) => file.relativeFilePath);
}

function messages(inventory: Inventory): string[] {
  return inventory.diagnostics.map((item) => `${item.code}: ${item.message}`);
}

describe('Mocha without a config file', () => {
  it("runs the .js, .cjs and .mjs files directly in ./test, as Mocha's default spec does", async () => {
    const root = project({
      'package.json': MOCHA_PACKAGE,
      'test/orders.js': TEST,
      'test/fees.cjs': TEST,
      'test/quotes.mjs': TEST,
      'test/positions.ts': TEST,
      'test/.draft.js': TEST,
      'test/integration/broker.js': TEST,
      'src/orders.spec.js': TEST,
    });
    const inventory = await scan({ root, framework: 'mocha' });
    expect(files(inventory)).toEqual(['test/fees.cjs', 'test/orders.js', 'test/quotes.mjs']);
    expect(inventory.configs).toEqual([]);
    expect(inventory.tests[0]).toMatchObject({ timeout: null, retries: null });
  });

  it('finds Mocha from its package or its config, without a framework', async () => {
    const fromPackage = await scan({ root: project({ 'package.json': MOCHA_PACKAGE, 'test/orders.js': TEST }) });
    expect(fromPackage.framework).toBe('mocha');
    const fromConfig = await scan({ root: project({ '.mocharc.yml': 'timeout: 5000\n', 'test/orders.js': TEST }) });
    expect(fromConfig.framework).toBe('mocha');
    const fromKey = await scan({
      root: project({ 'package.json': JSON.stringify({ mocha: { timeout: 5000 } }), 'test/orders.js': TEST }),
    });
    expect(fromKey.framework).toBe('mocha');
  });
});

describe('Mocha config files', () => {
  it('reads a .mocharc.yml: spec globs, extensions, ignore, and a timeout and retries for every test', async () => {
    const root = project({
      'package.json': MOCHA_PACKAGE,
      '.mocharc.yml': [
        '# order service',
        'spec:',
        '  - test/unit/**/*.spec.ts',
        '  - test/integration',
        'extension: [ts]',
        'recursive: true',
        'ignore: test/integration/legacy/**',
        "timeout: '5s'",
        'retries: 2',
        '',
      ].join('\n'),
      'test/unit/routing/venues.spec.ts': TEST,
      'test/unit/routing/venues.test.ts': TEST,
      'test/integration/broker.ts': TEST,
      'test/integration/fix/session.ts': TEST,
      'test/integration/fix/session.js': TEST,
      'test/integration/legacy/gateway.ts': TEST,
    });
    const inventory = await scan({ root, framework: 'mocha' });
    expect(files(inventory)).toEqual([
      'test/integration/broker.ts',
      'test/integration/fix/session.ts',
      'test/unit/routing/venues.spec.ts',
    ]);
    expect(inventory.tests[0]).toMatchObject({ timeout: 5000, retries: 2, timeoutSource: 'config' });
    expect(inventory.configs).toEqual([
      { relativeFilePath: '.mocharc.yml', extends: [], projects: [{ name: '', testDir: '.', dependencies: [] }] },
    ]);
  });

  it("joins the lists of the .mocharc file and the package.json mocha key, and takes the file's other keys", async () => {
    const root = project({
      'package.json': JSON.stringify({ mocha: { spec: 'test/fees.js', extension: ['js'], timeout: 1000, retries: 1 } }),
      '.mocharc.json': JSON.stringify({ spec: ['test/orders.js', 'test/blotter'], extension: ['cjs'], timeout: 3000 }),
      'test/orders.js': TEST,
      'test/fees.js': TEST,
      'test/quotes.js': TEST,
      'test/blotter/fills.js': TEST,
      'test/blotter/legacy.mjs': TEST,
    });
    const inventory = await scan({ root, framework: 'mocha' });
    expect(files(inventory)).toEqual(['test/blotter/fills.js', 'test/fees.js', 'test/orders.js']);
    expect(inventory.tests[0]).toMatchObject({ timeout: 3000, retries: 1 });
    expect(inventory.configs[0]).toMatchObject({ relativeFilePath: '.mocharc.json', extends: ['package.json'] });
  });

  it('reads the mocha key of package.json alone, and a .mocharc.jsonc with comments', async () => {
    const fromKey = await scan({
      root: project({
        'package.json': JSON.stringify({ mocha: { spec: 'spec/**/*.js', timeout: '1500ms' } }),
        'spec/orders.js': TEST,
      }),
      framework: 'mocha',
    });
    expect(files(fromKey)).toEqual(['spec/orders.js']);
    expect(fromKey.tests[0].timeout).toBe(1500);
    const fromJsonc = await scan({
      root: project({
        'package.json': MOCHA_PACKAGE,
        '.mocharc.jsonc':
          '{\n  // the specs of the blotter\n  "spec": "spec/*.js", /* every one */ "timeout": "1m"\n}\n',
        'spec/blotter.js': TEST,
      }),
      framework: 'mocha',
    });
    expect(files(fromJsonc)).toEqual(['spec/blotter.js']);
    expect(fromJsonc.tests[0].timeout).toBe(60_000);
  });

  it("reads a .mocharc.js as code, takes the first config file in Mocha's order, and finds one above the root", async () => {
    const root = project({
      '.mocharc.cjs': "module.exports = { spec: ['test/*.spec.js'], timeout: 4000 };\n",
      'packages/orders/.mocharc.js': "module.exports = { spec: 'test/*.spec.js', retries: 3 };\n",
      'packages/orders/.mocharc.json': '{ "spec": "nothing" }',
      'packages/orders/package.json': MOCHA_PACKAGE,
      'packages/orders/test/orders.spec.js': TEST,
      'packages/fees/test/fees.spec.js': TEST,
    });
    const orders = await scan({ root: path.join(root, 'packages/orders'), framework: 'mocha' });
    expect(files(orders)).toEqual(['test/orders.spec.js']);
    expect(orders.tests[0]).toMatchObject({ retries: 3, timeout: null });
    const fees = await scan({ root: path.join(root, 'packages/fees'), framework: 'mocha' });
    expect(fees.configs[0].relativeFilePath).toBe('../../.mocharc.cjs');
    expect(files(fees)).toEqual(['test/fees.spec.js']);
    expect(fees.tests[0].timeout).toBe(4000);
  });

  it('takes every file the globs match as run, less ignore, as the spec is often given on the command line', async () => {
    const root = project({
      'package.json': JSON.stringify({
        scripts: { test: 'mocha test/ test/acceptance/' },
        devDependencies: { mocha: '11.7.5' },
      }),
      '.mocharc.json': JSON.stringify({ ignore: ['test/acceptance/legacy-*.js'] }),
      'test/router.js': TEST,
      'test/acceptance/cookies.js': TEST,
      'test/acceptance/legacy-sessions.js': TEST,
    });
    const inventory = await scan({ root, framework: 'mocha', patterns: ['test/*.js', 'test/acceptance/*.js'] });
    expect(files(inventory)).toEqual([
      'test/acceptance/cookies.js',
      'test/acceptance/legacy-sessions.js',
      'test/router.js',
    ]);
    expect(messages(inventory)).toEqual([
      "file-not-run: The file has tests, but no config in its folder or above runs it, so the runner doesn't collect them; the nearest config is .mocharc.json.",
    ]);
    expect(inventory.files.map((file) => file.config)).toEqual(['.mocharc.json', '.mocharc.json', '.mocharc.json']);
  });

  it('takes an extension of several parts, comments in .mocharc.json, ignore as written, and file entries as loaded', async () => {
    const root = project({
      'package.json': MOCHA_PACKAGE,
      '.mocharc.json': [
        '{',
        '  // only the specs, not the page objects next to them',
        '  "spec": "test",',
        '  "recursive": true,',
        '  "extension": ["spec.js"],',
        '  "ignore": ["./test/fixtures/**", "test/legacy/**"],',
        '  "file": ["test/legacy/venue.spec.js"]',
        '}',
      ].join('\n'),
      'test/orders.spec.js': TEST,
      'test/pages/ticket.js': TEST,
      'test/fixtures/fills.spec.js': TEST,
      'test/legacy/venue.spec.js': TEST,
      'test/legacy/gateway.spec.js': TEST,
    });
    const inventory = await scan({ root, framework: 'mocha' });
    expect(files(inventory)).toEqual([
      'test/fixtures/fills.spec.js',
      'test/legacy/venue.spec.js',
      'test/orders.spec.js',
    ]);
  });

  it('runs a file named without its extension, a file the config loads first, and globs from the config folder', async () => {
    const root = project({
      'package.json': MOCHA_PACKAGE,
      '.mocharc.yml': 'spec: [test/smoke, ./test/e2e/*.js]\nfile: test/setup.js\n',
      'test/smoke.js': TEST,
      'test/setup.js': "before(() => {});\nit('connects to the exchange', () => {});\n",
      'test/e2e/checkout.js': TEST,
      'test/e2e/.hidden.js': TEST,
    });
    const inventory = await scan({ root, framework: 'mocha' });
    expect(files(inventory)).toEqual(['test/e2e/checkout.js', 'test/setup.js', 'test/smoke.js']);
  });

  it('reads suite and test with ui: tdd, and warns about an interface the scan does not read', async () => {
    const tdd = await scan({
      root: project({
        'package.json': MOCHA_PACKAGE,
        '.mocharc.yml': 'ui: tdd\n',
        'test/ledger.js': "suite('ledger', () => {\n  suiteSetup(() => {});\n  test('posts a fill', () => {});\n});\n",
      }),
      framework: 'mocha',
    });
    expect(tdd.tests.map((test) => test.fullName)).toEqual(['ledger > posts a fill']);
    expect(tdd.suites[0].hooks).toMatchObject({ beforeAll: 1 });
    const qunit = await scan({
      root: project({ 'package.json': MOCHA_PACKAGE, '.mocharc.yml': 'ui: qunit\n', 'test/ledger.js': TEST }),
      framework: 'mocha',
    });
    expect(messages(qunit)).toEqual([
      "config-value-unknown: The config's ui 'qunit' is an interface the scan doesn't read, so it reads the tests as Mocha's default, BDD.",
    ]);
  });

  it("can't tell which files run when the spec can't be worked out, and reports YAML it doesn't read", async () => {
    const dynamic = await scan({
      root: project({
        'package.json': MOCHA_PACKAGE,
        '.mocharc.cjs': 'module.exports = { spec: process.env.SPEC };\n',
        'test/orders.js': TEST,
      }),
      framework: 'mocha',
    });
    expect(files(dynamic)).toEqual([]);
    expect(dynamic.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown', 'no-files-matched']);
    const assumed = await scan({
      root: project({
        'package.json': MOCHA_PACKAGE,
        '.mocharc.cjs': "module.exports = { recursive: process.env.CI === 'true', ui: process.env.UI };\n",
        'test/orders.js': TEST,
      }),
      patterns: ['test/*.js'],
      framework: 'mocha',
    });
    expect(files(assumed)).toEqual(['test/orders.js']);
    expect(messages(assumed)).toEqual([
      "config-value-unknown: The config's recursive could not be worked out without running the config, so the scan takes its files to be run.",
      "config-value-unknown: The config's ui could not be worked out without running the config, so the scan reads the tests as Mocha's default, BDD.",
    ]);
    const unreadable = await scan({
      root: project({
        'package.json': JSON.stringify({ mocha: { timeout: 3000 } }),
        '.mocharc.yml': 'spec: |\n  test\n',
        'test/orders.js': TEST,
      }),
      patterns: ['test/*.js'],
      framework: 'mocha',
    });
    expect(unreadable.configs[0]).toMatchObject({ relativeFilePath: '.mocharc.yml', extends: ['package.json'] });
    expect(unreadable.tests[0].timeout).toBeNull();
    const yaml = await scan({
      root: project({
        'package.json': MOCHA_PACKAGE,
        '.mocharc.yaml': 'spec: &unit test/unit\n',
        'test/orders.js': TEST,
      }),
      framework: 'mocha',
    });
    expect(messages(yaml)).toContain(
      'config-value-unknown: The config could not be parsed on line 1: "&unit test/unit" uses YAML that is not read, so the scan reads none of its settings.',
    );
  });
});
