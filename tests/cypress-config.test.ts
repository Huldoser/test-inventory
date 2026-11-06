import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { project } from './project.ts';

const CYPRESS_PACKAGE = JSON.stringify({ name: 'trading-web', devDependencies: { cypress: '16.2.1' } });
const SPEC = "describe('order ticket', () => {\n  it('places a market order', () => {});\n});\n";

function placed(inventory: Inventory): [string, string[] | null][] {
  return inventory.tests.map((test) => [test.relativeFilePath, test.projects]);
}

describe('Cypress config files', () => {
  it("runs e2e specs from Cypress's default pattern, and component specs when the config sets up component testing", async () => {
    const root = project({
      'package.json': CYPRESS_PACKAGE,
      'cypress.config.ts': [
        "import { defineConfig } from 'cypress';",
        'export default defineConfig({',
        '  retries: { runMode: 1, openMode: 0 },',
        "  e2e: { baseUrl: 'http://localhost:3000', retries: { runMode: 2, openMode: 0 }, excludeSpecPattern: 'cypress/e2e/legacy/**' },",
        "  component: { devServer: { framework: 'react', bundler: 'vite' } },",
        '});',
        '',
      ].join('\n'),
      'cypress/e2e/orders/ticket.cy.ts': SPEC,
      'cypress/e2e/blotter.cy.js': SPEC,
      'cypress/e2e/legacy.spec.js': SPEC,
      'cypress/e2e/watchlist.hot-update.js': SPEC,
      'cypress/e2e/legacy/positions.cy.js': SPEC,
      'src/components/OrderTicket.cy.tsx': SPEC,
      'src/components/__snapshots__/OrderTicket.cy.js': SPEC,
      'node_modules/broker-ui/Button.cy.js': SPEC,
    });
    const inventory = await scan({ root, framework: 'cypress' });
    expect(placed(inventory)).toEqual([
      ['cypress/e2e/blotter.cy.js', ['e2e']],
      ['cypress/e2e/orders/ticket.cy.ts', ['e2e']],
      ['src/components/OrderTicket.cy.tsx', ['component']],
    ]);
    expect(inventory.tests.map((test) => test.retries)).toEqual([2, 2, 1]);
    expect(inventory.configs[0].projects?.map((item) => item.name)).toEqual(['e2e', 'component']);
  });

  it('reads specPattern and excludeSpecPattern against the whole path, and runs a given file only when specPattern takes it', async () => {
    const root = project({
      'package.json': CYPRESS_PACKAGE,
      'cypress.config.js': [
        'module.exports = {',
        "  e2e: { specPattern: 'tests/e2e/**/*.spec.{js,ts}', excludeSpecPattern: ['*.draft.spec.ts', 'tests/**/legacy/**', '**/*.wip.spec.ts'] },",
        '};',
        '',
      ].join('\n'),
      'tests/e2e/ticket.spec.ts': SPEC,
      'tests/e2e/margin.draft.spec.ts': SPEC,
      'tests/e2e/fills.wip.spec.ts': SPEC,
      'tests/e2e/legacy/blotter.spec.js': SPEC,
      'tests/e2e/.scratch.spec.ts': SPEC,
      'cypress/e2e/watchlist.cy.js': SPEC,
    });
    const found = await scan({ root, framework: 'cypress' });
    expect(placed(found)).toEqual([
      ['tests/e2e/margin.draft.spec.ts', ['e2e']],
      ['tests/e2e/ticket.spec.ts', ['e2e']],
    ]);
    const given = await scan({
      root,
      framework: 'cypress',
      patterns: ['cypress/e2e/*.cy.js', 'tests/e2e/ticket.spec.ts'],
    });
    expect(placed(given)).toEqual([
      ['cypress/e2e/watchlist.cy.js', []],
      ['tests/e2e/ticket.spec.ts', ['e2e']],
    ]);
  });

  it('reads ! and folders as globby does: ! takes files out of specPattern and is dropped in excludeSpecPattern', async () => {
    const root = project({
      'package.json': CYPRESS_PACKAGE,
      'cypress.config.js': [
        'module.exports = {',
        '  e2e: {',
        "    specPattern: ['cypress/e2e/**/*.cy.js', '!cypress/e2e/legacy/**'],",
        "    excludeSpecPattern: ['!cypress/e2e/drafts/**', 'cypress/e2e/archive'],",
        '  },',
        "  component: { specPattern: 'src/widgets/' },",
        '};',
        '',
      ].join('\n'),
      'cypress/e2e/orders/place.cy.js': SPEC,
      'cypress/e2e/legacy/old.cy.js': SPEC,
      'cypress/e2e/drafts/margin.cy.js': SPEC,
      'cypress/e2e/archive/fills.cy.js': SPEC,
      'cypress/e2e/helpers.js': SPEC,
      'src/widgets/OrderTicket.cy.jsx': SPEC,
      'src/widgets/format.js': SPEC,
      'src/charts/Candles.cy.jsx': SPEC,
    });
    expect(placed(await scan({ root, framework: 'cypress' }))).toEqual([
      ['cypress/e2e/orders/place.cy.js', ['e2e']],
      // A folder runs every file below it, as globby expands it to `src/widgets/**`.
      ['src/widgets/OrderTicket.cy.jsx', ['component']],
      ['src/widgets/format.js', ['component']],
    ]);
  });

  it("runs no file without a config, and can't tell the files when a pattern can't be worked out", async () => {
    const noConfig = await scan({
      root: project({ 'package.json': CYPRESS_PACKAGE, 'cypress/e2e/ticket.cy.js': SPEC }),
      framework: 'cypress',
    });
    expect(noConfig.files).toEqual([]);
    const given = await scan({
      root: project({ 'package.json': CYPRESS_PACKAGE, 'cypress/e2e/ticket.cy.js': SPEC }),
      framework: 'cypress',
      patterns: ['cypress/e2e/*.cy.js'],
    });
    expect(placed(given)).toEqual([['cypress/e2e/ticket.cy.js', null]]);
    const unsetRetries = await scan({
      root: project({
        'package.json': CYPRESS_PACKAGE,
        'cypress.config.js': 'module.exports = { retries: { runMode: null, openMode: 1 } };\n',
        'cypress/e2e/ticket.cy.js': SPEC,
      }),
      framework: 'cypress',
    });
    expect(unsetRetries.tests.map((test) => test.retries)).toEqual([null]);
    expect(unsetRetries.diagnostics).toEqual([]);
    const absolute = await scan({
      root: project({
        'package.json': CYPRESS_PACKAGE,
        'cypress.config.js': [
          "const path = require('node:path');",
          "module.exports = { e2e: { specPattern: path.join(__dirname, 'tests/e2e/**/*.spec.js') } };",
          '',
        ].join('\n'),
        'tests/e2e/ticket.spec.js': SPEC,
      }),
      framework: 'cypress',
    });
    expect(placed(absolute)).toEqual([['tests/e2e/ticket.spec.js', ['e2e']]]);
    const unknown = await scan({
      root: project({
        'package.json': CYPRESS_PACKAGE,
        'cypress.config.js': 'module.exports = { e2e: { specPattern: process.env.SPECS } };\n',
        'cypress/e2e/ticket.cy.js': SPEC,
      }),
      framework: 'cypress',
    });
    expect(unknown.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown', 'no-files-matched']);
    const assumed = await scan({
      root: project({
        'package.json': CYPRESS_PACKAGE,
        'cypress.config.js': 'module.exports = { e2e: { specPattern: process.env.SPECS } };\n',
        'cypress/e2e/ticket.cy.js': SPEC,
      }),
      framework: 'cypress',
      patterns: ['cypress/e2e/*.cy.js'],
    });
    expect(placed(assumed)).toEqual([['cypress/e2e/ticket.cy.js', null]]);
    expect(assumed.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown']);
  });

  it('finds Cypress from its package or its config, without a framework', async () => {
    const fromPackage = await scan({ root: project({ 'package.json': CYPRESS_PACKAGE }) });
    expect(fromPackage.framework).toBe('cypress');
    const fromConfig = await scan({ root: project({ 'cypress.config.js': 'module.exports = {};\n' }) });
    expect(fromConfig.framework).toBe('cypress');
  });
});
