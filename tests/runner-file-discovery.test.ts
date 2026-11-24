import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan } from '../src/index.ts';
import { project } from './project.ts';

const order = "it('settles the order', () => {});";
const playwrightOrder = "const {test} = require('@playwright/test'); test('settles the order', () => {});";

function manifest(pkg: string, version: string, command: string) {
  return JSON.stringify({ devDependencies: { [pkg]: version }, scripts: { test: command } });
}

function testSources(files: string[], source = order) {
  return Object.fromEntries(files.map((file) => [file, source]));
}

// Every fixture has one test per file. Check file discovery and the records consumers actually receive.
async function expectFiles(root: string, expected: string[]) {
  const inventory = await scan({ root });
  expect(inventory.files.map((file) => file.relativeFilePath).sort()).toEqual(expected);
  expect(inventory.tests.map((test) => test.relativeFilePath).sort()).toEqual(expected);
}

describe('Playwright project dependencies with a package-script file filter', () => {
  it.each([
    {
      connected: true,
      expected: ['tests/orders.spec.js', 'tests/session.clean.js', 'tests/session.prepare.js', 'tests/session.seed.js'],
    },
    { connected: false, expected: ['tests/orders.spec.js'] },
  ])(
    'collects the selected spec and its reachable projects when connected=$connected',
    async ({ connected, expected }) => {
      const config = {
        testDir: 'tests',
        projects: [
          { name: 'prepare', testMatch: '**/*.prepare.js' },
          { name: 'clean', testMatch: '**/*.clean.js' },
          { name: 'seed', testMatch: '**/*.seed.js', dependencies: ['prepare'], teardown: 'clean' },
          { name: 'ui', testMatch: '**/*.spec.js', dependencies: connected ? ['seed'] : [] },
        ],
      };
      const root = project({
        'package.json': manifest('@playwright/test', '1.65.1', 'playwright test orders.spec'),
        'playwright.config.cjs': 'module.exports = ' + JSON.stringify(config),
        ...testSources(
          [
            'tests/orders.spec.js',
            'tests/fees.spec.js',
            'tests/session.prepare.js',
            'tests/session.seed.js',
            'tests/session.clean.js',
          ],
          playwrightOrder,
        ),
      });
      await expectFiles(root, expected);
    },
  );
});

describe('working directory of a package-script file filter', () => {
  const runners: { pkg: string; version: string; command: string; config: Record<string, string>; source: string }[] = [
    {
      pkg: 'jest',
      version: '30.5.2',
      command: 'jest --runTestsByPath',
      config: { 'jest.config.cjs': "module.exports = {testMatch:['**/*.spec.js']};" },
      source: order,
    },
    {
      pkg: 'vitest',
      version: '5.1.0',
      command: 'vitest run',
      config: { 'vitest.config.mjs': "export default {test:{include:['**/*.spec.js']}};" },
      source: "import {it} from 'vitest'; " + order,
    },
    {
      pkg: '@playwright/test',
      version: '1.65.1',
      command: 'playwright test',
      config: { 'playwright.config.cjs': "module.exports = {testDir:'.'};" },
      source: playwrightOrder,
    },
    { pkg: 'mocha', version: '12.0.3', command: 'mocha', config: {}, source: order },
  ];

  describe.each(runners)('$pkg', ({ pkg, version, command, config, source }) => {
    it.each([
      ['the package root', command + ' desk/tests/orders.spec.js'],
      ['a subdirectory', 'cd desk && ' + command + ' tests/orders.spec.js'],
    ])('selects the desk spec when the command runs from %s', async (_, script) => {
      const root = project({
        ...config,
        'package.json': manifest(pkg, version, script),
        ...testSources(
          ['desk/tests/orders.spec.js', 'desk/tests/quotes.spec.js', 'tests/orders.spec.js', 'tests/fees.spec.js'],
          source,
        ),
      });
      await expectFiles(root, ['desk/tests/orders.spec.js']);
    });
  });
});

describe('Mocha spec lookup and options', () => {
  const fees = 'test/fees.js';
  const orders = 'test/orders.js';
  const quotes = 'test/quotes.js';

  function mochaProject(command: string, files: string[], settings: Record<string, unknown> = {}) {
    return project({
      'package.json': manifest('mocha', '12.0.3', command),
      '.mocharc.json': JSON.stringify(settings),
      ...testSources(files),
    });
  }

  it.each([
    { spec: './test/orders.js', ignore: './test/orders.js', expected: [fees] },
    { spec: './test/orders.js', ignore: orders, expected: [fees, orders] },
    { spec: './test/orders.js test/orders.js', ignore: orders, expected: [fees, orders] },
    { spec: orders, ignore: orders, expected: [fees] },
  ])('applies --ignore $ignore to the spec as written ($spec)', async ({ spec, ignore, expected }) => {
    const root = mochaProject(`mocha ${fees} ${spec} --ignore ${ignore}`, [fees, orders]);
    await expectFiles(root, expected);
  });

  it('matches an absolute ignore against the absolute spec', async () => {
    const root = project(testSources([fees, orders]));
    const absolute = path.join(root, orders).split(path.sep).join('/');
    writeFileSync(
      path.join(root, 'package.json'),
      manifest('mocha', '12.0.3', `mocha ${fees} "${absolute}" --ignore "${absolute}"`),
    );
    await expectFiles(root, [fees]);
  });

  it('applies both ignore and exclude entries from the same config', async () => {
    const root = mochaProject('mocha', [fees, orders, quotes], { spec: 'test/*.js', ignore: orders, exclude: quotes });
    await expectFiles(root, [fees]);
  });

  it.each([
    { form: 'comma-separated', extension: 'js,cjs' },
    { form: 'array', extension: ['js', 'cjs'] },
  ])('loads both configured extensions in $form form', async ({ extension }) => {
    const root = mochaProject('mocha test', [orders, 'test/quotes.cjs', 'test/fees.mjs'], { extension });
    await expectFiles(root, [orders, 'test/quotes.cjs']);
  });

  it.each([
    { form: 'comma-separated', file: 'preload/orders.js,preload/quotes.js' },
    { form: 'array', file: ['preload/orders.js', 'preload/quotes.js'] },
  ])('loads both configured preloads outside the test directory in $form form', async ({ file }) => {
    const root = mochaProject(
      `mocha ${fees}`,
      [fees, 'preload/orders.js', 'preload/quotes.js', 'preload/balances.js'],
      { file },
    );
    await expectFiles(root, ['preload/orders.js', 'preload/quotes.js', fees]);
  });

  it.each([
    ['preload/orders', 'preload/orders.js'],
    ['preload/hooks', 'preload/hooks/index.js'],
    ['preload/hooks/index.js', 'preload/hooks/index.js'],
  ])('resolves --file %s to %s', async (argument, source) => {
    const root = mochaProject(`mocha ${fees} --file ${argument}`, [
      fees,
      'preload/orders.js',
      'preload/hooks/index.js',
      'preload/hooks/fees.js',
    ]);
    await expectFiles(root, [source, fees]);
  });

  it('matches repeated configured extensions on an extensionless spec', async () => {
    const root = mochaProject('mocha test/orders', [
      'test/orders.cjs',
      orders,
      'test/orders.js.cjs',
      'test/orders-other.js',
    ]);
    await expectFiles(root, ['test/orders.cjs', orders, 'test/orders.js.cjs']);
  });
});

describe('shell directory changes before a Jest file argument', () => {
  it.each([
    ['cd desk;', 'desk/tests/orders.spec.js'],
    ['cd -- desk &&', 'desk/tests/orders.spec.js'],
    ['cd -L desk &&', 'desk/tests/orders.spec.js'],
    ['echo ready | cd desk &&', 'tests/orders.spec.js'],
    ['cd missing;', 'tests/orders.spec.js'],
  ])('resolves a file from the shell directory after %s', async (prefix, selected) => {
    const root = project({
      'package.json': manifest('jest', '30.5.2', prefix + ' jest --runTestsByPath tests/orders.spec.js'),
      'jest.config.cjs': "module.exports = {testMatch:['**/*.spec.js']};",
      ...testSources(['tests/orders.spec.js', 'desk/tests/orders.spec.js', 'desk/tests/quotes.spec.js']),
    });
    await expectFiles(root, [selected]);
  });
});

describe('Mocha glob expansion before file collection', () => {
  it.each([
    { spec: 'test/{orders,quotes}.js', expected: ['test/fees.js', 'test/orders.js.cjs'] },
    {
      spec: 'test/{orders,quotes}',
      expected: ['test/fees.js', 'test/orders.js', 'test/orders.js.cjs', 'test/quotes.js'],
    },
  ])('tries the configured extensions on the brace expression $spec', async ({ spec, expected }) => {
    const root = project({
      'package.json': manifest('mocha', '12.0.3', `mocha test/fees.js '${spec}'`),
      ...testSources(['test/fees.js', 'test/orders.js', 'test/orders.js.cjs', 'test/quotes.js']),
    });
    await expectFiles(root, expected);
  });
  it('matches a dotted ignore glob against only the specs with the same prefix', async () => {
    const root = project({
      'package.json': manifest('mocha', '12.0.3', "mocha ./test/orders.js test/quotes.js --ignore './test/*.js'"),
      ...testSources(['test/orders.js', 'test/quotes.js']),
    });
    await expectFiles(root, ['test/quotes.js']);
  });
});

it('reports an unknown script working directory when a package leaves the scanned project', async () => {
  const root = project({
    'package.json': manifest('vitest', '5.1.0', 'cd .. && vitest run'),
    'tests/orders.spec.js': "import {it} from 'vitest'; " + order,
  });
  const result = await scan({ root });
  expect(result.diagnostics.map((d) => d.code)).toContain('config-value-unknown');
});
