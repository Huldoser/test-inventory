import { describe, expect, it } from 'vitest';
import { filterInventory, runCommands, scanSource } from '../src/index.ts';
import { readGolden } from './examples.ts';

const commands = (name: string) => runCommands(readGolden(name)).map((item) => item.command);

describe('runCommands', () => {
  it('runs the tests a change can affect with their Playwright config and projects', () => {
    const affected = filterInventory(readGolden('trading-web'), { related: ['pages/orders-blotter.ts'] });
    expect(runCommands(affected)).toEqual([
      {
        config: 'playwright.config.ts',
        projects: ['chromium', 'webkit'],
        files: [
          'tests/orders/limit-orders.spec.ts',
          'tests/orders/market-orders.spec.ts',
          'tests/orders/order-lifecycle.spec.ts',
          'tests/portfolio.spec.ts',
        ],
        command:
          'npx playwright test tests/orders/limit-orders.spec.ts tests/orders/market-orders.spec.ts tests/orders/order-lifecycle.spec.ts tests/portfolio.spec.ts --config playwright.config.ts --project chromium webkit',
        caveat: null,
      },
    ]);
  });

  it('gives each config of a Vitest monorepo its own command, with its project', () => {
    expect(commands('trading-monorepo')).toEqual([
      'npx vitest run packages/broker-gateway/src/rate-limiter.test.ts --config packages/broker-gateway/vitest.config.ts --project broker-gateway',
      'npx vitest run packages/market-data/src/quote-cache.test.ts --config packages/market-data/vitest.config.ts --project market-data',
      'npx vitest run packages/risk/src/exposure.test.ts --config packages/risk/vitest.config.ts --project risk',
    ]);
    expect(commands('chart-browser')).toEqual([
      'npx vitest run src/candlestick-chart.test.ts --config vitest.config.ts --project chromium --project webkit',
    ]);
  });

  it('selects Jest projects by name and passes exact paths', () => {
    const unit = filterInventory(readGolden('settlement-service'), { grep: 'netting|calendar' });
    expect(runCommands(unit).map((item) => item.command)).toEqual([
      'npx jest --config jest.config.js --selectProjects unit --runTestsByPath src/__tests__/calendar.js src/netting.test.js',
    ]);
  });

  it('runs Cypress end-to-end and component specs with one command each', () => {
    expect(commands('trading-components-cypress')).toEqual([
      'npx cypress run --config-file cypress.config.js --component --spec src/OrderTicket.cy.tsx',
      'npx cypress run --config-file cypress.config.js --spec cypress/e2e/orders.cy.js',
    ]);
  });

  it('runs Mocha, Jasmine, WebdriverIO, node:test and Bun files the way each takes them', () => {
    expect(runCommands(readGolden('fix-gateway'))).toEqual([
      expect.objectContaining({
        command:
          'npx mocha --config .mocharc.yml test/integration/venues.spec.js test/messages.spec.js test/session.spec.js',
        caveat: 'Mocha adds the files to the spec of the config, so every spec the config lists runs too.',
      }),
    ]);
    expect(commands('risk-service')).toEqual([
      'npx jasmine --config=spec/support/jasmine.json spec/exposure.spec.js spec/limits/var.spec.js',
    ]);
    expect(commands('broker-portal')).toEqual([
      'npx wdio run wdio.conf.js --spec test/specs/accounts/statements.e2e.js --spec test/specs/login.e2e.js --spec test/specs/orders/ticket.e2e.js',
    ]);
    expect(commands('pricing-service')).toEqual([
      'node --test src/spread.test.js test/fx/cross-rates.js test/quotes.test.js',
    ]);
    expect(commands('quote-gateway')).toEqual(['bun test ./src/quotes/spread.test.ts ./src/routing/router.spec.ts']);
  });

  it('quotes a path the shell would split, and says when WebdriverIO has no config to run', () => {
    const code = "import { test } from 'vitest';\ntest('fills a limit order', () => {});\n";
    const spaced = scanSource({ code, relativeFilePath: "tests/order book's depth.test.ts", framework: 'vitest' });
    expect(runCommands(spaced).map((item) => item.command)).toEqual([
      "npx vitest run 'tests/order book'\\''s depth.test.ts'",
    ]);
    const wdio = scanSource({
      code: "describe('login', () => {\n  it('signs in a trader', async () => {});\n});\n",
      relativeFilePath: 'test/specs/login.e2e.js',
      framework: 'webdriverio',
    });
    expect(runCommands(wdio)).toEqual([
      {
        config: null,
        projects: [],
        files: ['test/specs/login.e2e.js'],
        command: 'npx wdio run --spec test/specs/login.e2e.js',
        caveat: "No WebdriverIO config was found, and 'wdio run' needs one, as in 'npx wdio run wdio.conf.ts'.",
      },
    ]);
  });

  it('leaves out what the scan found no config or projects for', () => {
    expect(commands('trading-e2e-puppeteer')).toEqual([
      'npx jest --config jest.config.js --runTestsByPath e2e/order-ticket.e2e.js e2e/watchlist.e2e.js',
    ]);
    // Mocha reads a config from package.json with --package.
    const gateway = readGolden('fix-gateway');
    const fromPackage = { ...gateway, files: gateway.files.map((file) => ({ ...file, config: 'package.json' })) };
    expect(runCommands(fromPackage)[0].command).toBe(
      'npx mocha --package package.json test/integration/venues.spec.js test/messages.spec.js test/session.spec.js',
    );
    const single = (framework: 'mocha' | 'jasmine' | 'cypress', relativeFilePath: string) =>
      runCommands(
        scanSource({
          code: "describe('order ticket', () => {\n  it('places a limit order', () => {});\n});\n",
          relativeFilePath,
          framework,
        }),
      ).map(({ command, caveat }) => [command, caveat]);
    expect(single('mocha', 'test/orders.spec.js')).toEqual([['npx mocha test/orders.spec.js', null]]);
    expect(single('jasmine', 'spec/orders.spec.js')).toEqual([['npx jasmine spec/orders.spec.js', null]]);
    expect(single('cypress', 'cypress/e2e/orders.cy.js')).toEqual([
      ['npx cypress run --spec cypress/e2e/orders.cy.js', null],
    ]);
  });

  it('escapes the characters node:test reads as a glob, so a route folder like [venue] matches only itself', () => {
    const route = scanSource({
      code: "import { test } from 'node:test';\ntest('quotes the venue', () => {});\n",
      relativeFilePath: 'test/routes/[venue]/{quotes}*.test.js',
      framework: 'node',
    });
    expect(runCommands(route).map((item) => item.command)).toEqual([
      "node --test 'test/routes/[[]venue[]]/[{]quotes[}][*].test.js'",
    ]);
  });

  it('gives no command when no test is kept', () => {
    expect(runCommands(filterInventory(readGolden('trading-web'), { related: ['README.md'] }))).toEqual([]);
  });
});
