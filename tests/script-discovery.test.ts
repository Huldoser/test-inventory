import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan } from '../src/index.ts';
import { project } from './project.ts';

const order = "it('settles the order', () => {});";
const paths = async (root: string) => (await scan({ root })).files.map((file) => file.relativeFilePath);

describe('Mocha package command discovery', () => {
  const orders = 'test/orders.spec.js';
  const quotes = 'test/quotes.cjs';
  const fees = 'test/nested/fees.spec.js';
  const balances = 'specs/balances.js';
  const cases: [string, object, string, boolean, string[]][] = [
    ['configured and CLI extensions', { spec: 'test', extension: ['js'] }, '--extension cjs', true, [orders, quotes]],
    ['configured and CLI specs', { spec: orders }, '--spec ' + balances, true, [balances, orders]],
    [
      'configured and CLI preloads',
      { spec: orders, file: balances },
      '--file ' + quotes,
      true,
      [balances, orders, quotes],
    ],
    ['configured and CLI ignores', { spec: 'test/**/*', ignore: quotes }, '--ignore ' + orders, true, [fees]],
    [
      'a CLI false value overriding recursive config',
      { spec: 'test', recursive: true },
      '--recursive=false',
      true,
      [orders, quotes],
    ],
    [
      'an assigned no-recursive option leaving the configured flag alone',
      { spec: 'test', recursive: true },
      '--no-recursive=false',
      true,
      [fees, orders, quotes],
    ],
    ['a CLI ignore with the default config', { spec: 'test/**/*' }, '--ignore ' + quotes, false, [fees, orders]],
    [
      'disabled recursion over a recursive config',
      { spec: 'test', recursive: true },
      '--no-recursive',
      true,
      [orders, quotes],
    ],
  ];
  it.each(cases)('honors %s', async (_, config, args, named, expected) => {
    const file = named ? 'settings/mocha.json' : '.mocharc.json';
    const command = named ? 'mocha --config ' + file : 'mocha';
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { mocha: '12.0.3' }, scripts: { test: command + ' ' + args } }),
      [file]: JSON.stringify(config),
      [orders]: order,
      [quotes]: order,
      [fees]: order,
      [balances]: order,
    });
    expect(await paths(root)).toEqual(expected);
  });
  it('uses an existing literal bracketed spec before glob expansion', async () => {
    const root = project({
      'package.json': JSON.stringify({
        devDependencies: { mocha: '12.0.3' },
        scripts: { test: "mocha 'specs/[orders].js'" },
      }),
      'specs/[orders].js': order,
      'specs/o.js': order,
    });
    expect(await paths(root)).toEqual(['specs/[orders].js']);
  });
});

describe('package scripts selecting individual runner files', () => {
  const pw = "const {test} = require('@playwright/test'); test('settles the order', () => {});";
  it.each([
    ['jest', '30.5.2', 'jest.config.cjs', 'module.exports = {};', 'jest --runTestsByPath', order],
    ['vitest', '5.1.0', 'vitest.config.mjs', 'export default {};', 'vitest run', "import {it} from 'vitest'; " + order],
    ['@playwright/test', '1.65.1', 'playwright.config.js', 'module.exports = {};', 'playwright test', pw],
    ['@playwright/test', '1.65.1', '', '', 'playwright test', pw],
  ])('combines selected files from %s %s scripts using %s', async (pkg, version, config, settings, command, body) => {
    const root = project({
      'package.json': JSON.stringify({
        devDependencies: { [pkg]: version },
        scripts: { test: command + ' tests/orders.spec.js', 'test:quotes': command + ' tests/quotes.spec.js' },
      }),
      ...(config ? { [config]: settings } : {}),
      'tests/orders.spec.js': body,
      'tests/quotes.spec.js': body,
      'tests/fees.spec.js': body,
    });
    expect(await paths(root)).toEqual(['tests/orders.spec.js', 'tests/quotes.spec.js']);
  });
  it('keeps the complete Jest config when a second script starts an unfiltered run', async () => {
    const root = project({
      'package.json': JSON.stringify({
        scripts: { test: 'jest --ci --runTestsByPath tests/orders.spec.js', full: 'jest' },
        devDependencies: { jest: '30.5.2' },
      }),
      'tests/orders.spec.js': order,
      'tests/quotes.spec.js': order,
    });
    expect(await paths(root)).toEqual(['tests/orders.spec.js', 'tests/quotes.spec.js']);
  });

  it('matches exact Jest paths from the script folder and lets explicit scan globs select a sibling', async () => {
    const root = project({
      'package.json': JSON.stringify({
        scripts: { test: 'jest --runTestsByPath --config settings/jest.cjs ./tests/orders.spec.js' },
        devDependencies: { jest: '30.5.2' },
      }),
      'jest.config.cjs': "module.exports = {testMatch: ['**/smoke/*.spec.js']};",
      'settings/jest.cjs': "module.exports = {rootDir: '..'};",
      'tests/orders.spec.js': order,
      'other/tests/orders.spec.js': order,
      'smoke/quotes.spec.js': order,
    });
    expect(await paths(root)).toEqual(['smoke/quotes.spec.js', 'tests/orders.spec.js']);
    const explicit = await scan({ root, patterns: ['other/**/*.js'] });
    expect(explicit.tests.map((test) => test.relativeFilePath)).toEqual(['other/tests/orders.spec.js']);
    expect(explicit.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('file-not-run');
  });

  it('reports a file outside the scan root when its own config excludes it', async () => {
    const workspace = project({
      'app/package.json': JSON.stringify({
        devDependencies: { vitest: '5.1.0' },
        scripts: { test: 'vitest run orders' },
      }),
      'shared/vitest.config.mjs': "export default {test:{include:['**/quotes.test.js']}};",
      'shared/orders.test.js': "import {it} from 'vitest'; " + order,
    });
    const result = await scan({ root: path.join(workspace, 'app'), patterns: ['../shared/*.test.js'] });
    expect(result.diagnostics.map((d) => d.code)).toContain('file-not-run');
  });

  it('resolves Vitest filters from the package folder while matching paths within test.dir', async () => {
    const unit = "import {it} from 'vitest'; " + order;
    const root = project({
      'vitest.config.mjs': "export default {test:{dir:'tests'}};",
      'tests/orders/filled.spec.js': unit,
      'tests/orders-open.spec.js': unit,
      'tests/quotes.spec.js': unit,
      'tests/risk.spec.js': unit,
    });
    const absolute = path.join(root, 'tests', 'risk.spec.js').split(path.sep).join('/');
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        devDependencies: { vitest: '5.1.0' },
        scripts: { test: `vitest run --coverage ./tests/orders/ QUOTES "${absolute}"` },
      }),
    );
    expect(await paths(root)).toEqual(['tests/orders/filled.spec.js', 'tests/quotes.spec.js', 'tests/risk.spec.js']);
  });

  it('matches Playwright filters as regular expressions on the full path', async () => {
    const root = project({
      'package.json': JSON.stringify({
        devDependencies: { '@playwright/test': '1.65.1' },
        scripts: { test: 'playwright test orders.spec /QUOTES/ /fee/gi' },
      }),
      'orders-spec.spec.js': pw,
      'quotes-buy.spec.js': pw,
      'QUOTES-sell.spec.js': pw,
      'FEES.spec.js': pw,
      'risk.spec.js': pw,
    });
    expect(await paths(root)).toEqual(['FEES.spec.js', 'QUOTES-sell.spec.js', 'orders-spec.spec.js']);
  });

  it('keeps other package commands when Playwright rejects a file expression', async () => {
    const root = project({
      'package.json': JSON.stringify({
        devDependencies: { '@playwright/test': '1.65.1' },
        scripts: { invalid: 'playwright test risk /risk/ii', test: 'playwright test orders' },
      }),
      'orders.spec.js': pw,
      'risk.spec.js': pw,
    });
    expect(await paths(root)).toEqual(['orders.spec.js']);
  });

  it.each(["playwright test 'ORDERS|QUOTES'", 'playwright test "$TEST_FILE"'])(
    'keeps the configured file set for %s',
    async (extra) => {
      const root = project({
        'package.json': JSON.stringify({
          devDependencies: { '@playwright/test': '1.65.1' },
          scripts: {
            test: 'playwright test orders',
            extra,
          },
        }),
        'playwright.config.js': 'module.exports = {};',
        'orders.spec.js': pw,
        'quotes.spec.js': pw,
        'risk.spec.js': pw,
      });
      expect(await paths(root)).toEqual(['orders.spec.js', 'quotes.spec.js', 'risk.spec.js']);
    },
  );
});
