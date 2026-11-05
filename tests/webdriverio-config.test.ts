import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { project } from './project.ts';

const WDIO_PACKAGE = JSON.stringify({ name: 'trading-e2e', devDependencies: { '@wdio/cli': '10.1.0' } });
const SPEC = "describe('order ticket', () => {\n  it('places a market order', async () => {});\n});\n";

function placed(inventory: Inventory): [string, number | null, number | null][] {
  return inventory.tests.map((test) => [test.relativeFilePath, test.timeout, test.retries]);
}

describe('WebdriverIO config files', () => {
  it("runs the files of the config's specs, groups included, less exclude, with mochaOpts' timeout and retries", async () => {
    const root = project({
      'package.json': WDIO_PACKAGE,
      'wdio.conf.js': [
        'exports.config = {',
        "  specs: [['./test/specs/orders/*.e2e.js', './test/specs/fills/*.e2e.js'], 'blotter.e2e.js'],",
        "  exclude: ['./test/specs/orders/legacy-*.e2e.js'],",
        "  framework: 'mocha',",
        "  mochaOpts: { ui: 'bdd', timeout: '1m', retries: 1 },",
        "  capabilities: [{ browserName: 'chrome' }],",
        '};',
        '',
      ].join('\n'),
      'test/specs/orders/ticket.e2e.js': SPEC,
      'test/specs/orders/legacy-ticket.e2e.js': SPEC,
      'test/specs/orders/ticket.e2e.json': SPEC,
      'test/specs/fills/partial.e2e.js': SPEC,
      'test/specs/blotter/blotter.e2e.js': SPEC,
      'test/specs/.drafts/blotter.e2e.js': SPEC,
      'test/specs/watchlist.e2e.js': SPEC,
    });
    const inventory = await scan({ root, framework: 'webdriverio' });
    expect(placed(inventory)).toEqual([
      ['test/specs/blotter/blotter.e2e.js', 60_000, 1],
      ['test/specs/fills/partial.e2e.js', 60_000, 1],
      ['test/specs/orders/ticket.e2e.js', 60_000, 1],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads a config exported as an ES module, and exclude entries as text in the path when one is not a glob', async () => {
    const root = project({
      'package.json': WDIO_PACKAGE,
      'wdio.conf.ts': [
        "import type { Options } from '@wdio/types';",
        'export const config: Options.Testrunner = {',
        "  specs: ['./test/**/*.ts'],",
        "  exclude: ['legacy', 'smoke'],",
        "  suites: { smoke: ['./test/smoke/*.ts'] },",
        '  capabilities: [],',
        '};',
        '',
      ].join('\n'),
      'test/orders/ticket.ts': SPEC,
      'test/orders/legacy/ticket.ts': SPEC,
      'test/smoke/login.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'webdriverio' });
    expect(inventory.tests.map((test) => test.relativeFilePath)).toEqual([
      'test/orders/ticket.ts',
      'test/smoke/login.ts',
    ]);
    expect(inventory.configs.map((config) => config.relativeFilePath)).toEqual(['wdio.conf.ts']);
  });

  it("reads Jasmine's specs with jasmineOpts' timeout when the config's framework is jasmine", async () => {
    const root = project({
      'package.json': WDIO_PACKAGE,
      'wdio.conf.js': [
        'export const config = {',
        "  specs: ['./test/specs/**/*.js'],",
        "  framework: 'jasmine',",
        '  jasmineOpts: { defaultTimeoutInterval: 120000 },',
        '};',
        '',
      ].join('\n'),
      'test/specs/ticket.js': [
        "describe('order ticket', () => {",
        "  it('places a market order', async () => {}, 5000, 2);",
        "  it('places a limit order', async () => {});",
        "  it('places a stop order', async () => {}, 5000, Number(process.env.RETRIES));",
        '});',
        '',
      ].join('\n'),
    });
    const inventory = await scan({ root, framework: 'webdriverio' });
    expect(inventory.tests.map((test) => [test.title, test.state, test.timeout, test.retries])).toEqual([
      ['places a market order', 'active', 5000, 2],
      ['places a limit order', 'active', 120_000, null],
      ['places a stop order', 'active', 5000, null],
    ]);
    expect(inventory.diagnostics.map((item) => item.code)).toEqual(['unresolved-option']);
    const zeroInterval = await scan({
      root: project({
        'package.json': WDIO_PACKAGE,
        'wdio.conf.js':
          "exports.config = { specs: ['*.js'], framework: 'jasmine', jasmineOpts: { defaultTimeoutInterval: 0 } };\n",
        'ticket.js': SPEC,
      }),
      framework: 'webdriverio',
    });
    expect(zeroInterval.tests.map((test) => test.timeout)).toEqual([60_000]);
  });

  it("reads globs from rootDir, with a capability's own specs and excludes, and \\ or .. in a path", async () => {
    const files = {
      'package.json': WDIO_PACKAGE,
      'e2e/specs/orders/ticket.e2e.js': SPEC,
      'e2e/specs/orders/legacy-ticket.e2e.js': SPEC,
      'e2e/specs/login.e2e.js': SPEC,
      'e2e/smoke/login.e2e.js': SPEC,
    };
    const rootDir = await scan({
      root: project({
        ...files,
        'wdio.conf.js': [
          'exports.config = {',
          "  rootDir: 'e2e',",
          "  specs: ['./specs/**/*.e2e.js', './smoke/../specs/login.e2e.js'],",
          "  exclude: ['specs\\\\orders\\\\legacy-*.e2e.js'],",
          '};',
          '',
        ].join('\n'),
      }),
      framework: 'webdriverio',
    });
    expect(rootDir.tests.map((test) => test.relativeFilePath)).toEqual([
      'e2e/specs/login.e2e.js',
      'e2e/specs/orders/ticket.e2e.js',
    ]);
    const capabilities = await scan({
      root: project({
        ...files,
        'wdio.conf.js': [
          'exports.config = {',
          "  specs: ['./e2e/specs/**/*.e2e.js'],",
          '  capabilities: [',
          "    { browserName: 'chrome', 'wdio:exclude': ['./e2e/specs/orders/legacy-*.e2e.js'] },",
          "    { browserName: 'firefox', 'wdio:specs': ['./e2e/smoke/*.e2e.js'] },",
          '  ],',
          '};',
          '',
        ].join('\n'),
      }),
      framework: 'webdriverio',
    });
    expect(capabilities.tests.map((test) => test.relativeFilePath)).toEqual([
      'e2e/smoke/login.e2e.js',
      'e2e/specs/login.e2e.js',
      'e2e/specs/orders/ticket.e2e.js',
    ]);
    for (const unread of [
      'rootDir: process.env.E2E_ROOT',
      'exclude: process.env.EXCLUDE',
      "specs: ['./e2e/**/*.e2e.js'], capabilities: [{ 'wdio:specs': process.env.SPECS }]",
      "specs: ['./e2e/**/*.e2e.js'], capabilities: [{ exclude: process.env.EXCLUDE }]",
    ]) {
      const unknown = await scan({
        root: project({ ...files, 'wdio.conf.js': `exports.config = { ${unread} };\n` }),
        framework: 'webdriverio',
      });
      expect(
        unknown.diagnostics.map((item) => item.code),
        unread,
      ).toEqual(['config-value-unknown', 'no-files-matched']);
    }
  });

  it("reads mochaOpts' ui, and reports a framework the scan doesn't read", async () => {
    const tdd = await scan({
      root: project({
        'package.json': WDIO_PACKAGE,
        'wdio.conf.js': "exports.config = { specs: ['test/*.js'], mochaOpts: { ui: 'tdd' } };\n",
        'test/ticket.js': "suite('order ticket', () => {\n  test('places a market order', async () => {});\n});\n",
      }),
      framework: 'webdriverio',
    });
    expect(tdd.tests.map((test) => test.fullName)).toEqual(['order ticket > places a market order']);
    const cucumber = await scan({
      root: project({
        'package.json': WDIO_PACKAGE,
        'wdio.conf.js': "exports.config = { specs: ['test/*.js'], framework: 'cucumber' };\n",
        'test/ticket.js': SPEC,
      }),
      framework: 'webdriverio',
    });
    expect(cucumber.diagnostics.map((item) => item.message)).toEqual([
      "The config's framework 'cucumber' is one the scan doesn't read, so it reads the tests as WebdriverIO's default, Mocha's.",
    ]);
    const unknown = await scan({
      root: project({
        'package.json': WDIO_PACKAGE,
        'wdio.conf.js': "exports.config = { specs: ['test/*.js'], framework: process.env.FRAMEWORK };\n",
        'test/ticket.js': SPEC,
      }),
      framework: 'webdriverio',
    });
    expect(unknown.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown']);
    expect(unknown.tests).toHaveLength(1);
  });

  it("runs no file without a config, files given by glob less exclude, and can't tell the files when specs can't be worked out", async () => {
    const noConfig = await scan({
      root: project({ 'package.json': WDIO_PACKAGE, 'test/specs/ticket.e2e.js': SPEC }),
      framework: 'webdriverio',
    });
    expect(noConfig.files).toEqual([]);
    const given = await scan({
      root: project({
        'package.json': WDIO_PACKAGE,
        'wdio.conf.js':
          "exports.config = { specs: ['./test/specs/**/*.js'], exclude: ['./test/specs/legacy/*.js'] };\n",
        'test/specs/legacy/ticket.e2e.js': SPEC,
        'test/flows/ticket.e2e.js': SPEC,
      }),
      framework: 'webdriverio',
      patterns: ['test/**/*.e2e.js'],
    });
    expect(given.tests.map((test) => [test.relativeFilePath, test.projects])).toEqual([
      ['test/flows/ticket.e2e.js', ['']],
      ['test/specs/legacy/ticket.e2e.js', []],
    ]);
    const givenWithoutConfig = await scan({
      root: project({ 'package.json': WDIO_PACKAGE, 'test/specs/ticket.e2e.js': SPEC }),
      framework: 'webdriverio',
      patterns: ['test/specs/*.e2e.js'],
    });
    expect(placed(givenWithoutConfig)).toEqual([['test/specs/ticket.e2e.js', null, null]]);
    const absolute = await scan({
      root: project({
        'package.json': WDIO_PACKAGE,
        'wdio.conf.js': [
          "const path = require('node:path');",
          "exports.config = { specs: path.join(__dirname, 'test/specs/*.e2e.js') };",
          '',
        ].join('\n'),
        'test/specs/ticket.e2e.js': SPEC,
      }),
      framework: 'webdriverio',
    });
    expect(placed(absolute)).toEqual([['test/specs/ticket.e2e.js', null, null]]);
    const unknown = await scan({
      root: project({
        'package.json': WDIO_PACKAGE,
        'wdio.conf.js': 'exports.config = { specs: process.env.SPECS.split(",") };\n',
        'test/specs/ticket.e2e.js': SPEC,
      }),
      framework: 'webdriverio',
    });
    expect(unknown.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown', 'no-files-matched']);
    const noExport = await scan({
      root: project({
        'package.json': WDIO_PACKAGE,
        'wdio.conf.js': "module.exports = { specs: ['test/*.js'] };\n",
        'test/ticket.js': SPEC,
      }),
      framework: 'webdriverio',
      patterns: ['test/*.js'],
    });
    expect(noExport.diagnostics.map((item) => item.message)).toEqual([
      'The config has no `config` export the scan can find, so the scan reads none of its settings.',
    ]);
  });

  it('finds WebdriverIO from @wdio/cli or its config, without a framework', async () => {
    const fromPackage = await scan({ root: project({ 'package.json': WDIO_PACKAGE }) });
    expect(fromPackage.framework).toBe('webdriverio');
    const fromConfig = await scan({ root: project({ 'wdio.conf.ts': 'export const config = {};\n' }) });
    expect(fromConfig.framework).toBe('webdriverio');
  });
});
