import { describe, expect, it } from 'vitest';
import { scan } from '../src/index.ts';
import { project } from './project.ts';

describe('root-only runner configs', () => {
  it('does not switch a Cypress spec to a nested config', async () => {
    const root = project({
      'cypress.config.js': "module.exports = { e2e: { specPattern: 'root/**/*.cy.js' } };",
      'nested/cypress.config.js': "module.exports = { e2e: { specPattern: '**/*.cy.js' } };",
      'nested/orders.cy.js': "it('routes a market order', () => {});",
    });
    const inventory = await scan({
      root,
      framework: 'cypress',
      patterns: ['nested/*.cy.js'],
      frameworkVersion: '16.2.0',
    });
    expect(inventory.tests[0].projects).toEqual([]);
    expect(inventory.files[0].config).toBe('cypress.config.js');
    expect(inventory.diagnostics.map((item) => item.code)).toContain('file-not-run');
  });

  it('does not switch a WebdriverIO spec to a nested config', async () => {
    const root = project({
      'wdio.conf.js': "exports.config = { specs: ['./root/*.js'], mochaOpts: { timeout: 100 } };",
      'nested/wdio.conf.js': "exports.config = { specs: ['./*.js'], mochaOpts: { timeout: 200 } };",
      'nested/orders.js': "it('routes a market order', () => {});",
    });
    const inventory = await scan({
      root,
      framework: 'webdriverio',
      patterns: ['nested/orders.js'],
      frameworkVersion: '10.1.0',
    });
    expect(inventory.tests[0].projects).toEqual(['']);
    expect(inventory.tests[0].timeout).toBe(100);
    expect(inventory.files[0].config).toBe('wdio.conf.js');
  });
});

describe('Jest project and pattern boundaries', () => {
  it('takes standalone project config files from a glob and ignores matching documentation', async () => {
    const root = project({
      'jest.config.js': "module.exports = { projects: ['./projects/configs/*'] };",
      'projects/configs/orders.cjs': "module.exports = { rootDir: '../orders', displayName: 'orders' };",
      'projects/configs/README.md': 'Order routing checks',
      'projects/orders/routes.test.js': "test('routes a market order', () => {});",
    });
    const inventory = await scan({ root, framework: 'jest', frameworkVersion: '30.5.0' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.projects])).toEqual([
      ['projects/orders/routes.test.js', ['orders']],
    ]);
  });

  it('does not treat a mixed positive and negative testMatch list as all-negative', async () => {
    const root = project({
      'jest.config.js': "module.exports = { testMatch: ['**/orders.test.js', '!**/*.draft.test.js'] };",
      'src/orders.test.js': "test('routes an order', () => {});",
      'src/quotes.test.js': "test('quotes a spread', () => {});",
      'src/orders.draft.test.js': "test('routes a draft order', () => {});",
    });
    const inventory = await scan({ root, framework: 'jest', frameworkVersion: '30.5.0' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(['src/orders.test.js']);
  });
});

describe('Node script and TypeScript boundaries', () => {
  it.each([
    ['23.5.0', false],
    ['23.6.0', true],
    ['22.17.0', false],
    ['22.18.0', true],
  ] as const)('discovers TypeScript tests without flags on Node %s: %s', async (frameworkVersion, included) => {
    const root = project({
      'tests/orders.test.ts': "import { test } from 'node:test'; test('routes an order', () => {});",
    });
    const inventory = await scan({ root, framework: 'node', frameworkVersion });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(included ? ['tests/orders.test.ts'] : []);
  });

  it('finds a test command after an unrelated script when no test script exists', async () => {
    const root = project({
      'package.json': JSON.stringify({
        scripts: { lint: 'eslint .', 'check:orders': 'node --test checks/order-routing.mjs' },
      }),
      'checks/order-routing.mjs': "import { test } from 'node:test'; test('routes an order', () => {});",
      'tests/quotes.test.mjs': "import { test } from 'node:test'; test('quotes a spread', () => {});",
    });
    const inventory = await scan({ root, framework: 'node', frameworkVersion: '26.2.0' });
    expect(inventory.files.map((file) => file.relativeFilePath)).toEqual(['checks/order-routing.mjs']);
  });
});
