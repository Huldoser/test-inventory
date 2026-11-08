import { describe, expect, it } from 'vitest';
import { scan } from '../src/index.ts';
import { project, VITEST_PACKAGE } from './project.ts';
import { scanBun, scanMocha, scanNode, scanVitest } from './helpers.ts';

describe('Vitest table modifier regressions', () => {
  it('warns when projects disagree, also for a focused test registered by a helper', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': `export default { test: { projects: [
        { test: { name: 'paper', include: ['tests/*.test.ts'], allowOnly: true } },
        { test: { name: 'live', include: ['tests/*.test.ts'], allowOnly: false } },
      ] } };`,
      'tests/orders.test.ts': "import { registerOrders } from './register.ts'; registerOrders();",
      'tests/register.ts':
        "import { test } from 'vitest'; export function registerOrders() { test.only('opens a paper order', () => {}); }",
    });
    const result = await scan({ root, framework: 'vitest' });
    expect(result.diagnostics.filter(({ code }) => code === 'forbidden-only').map(({ level }) => level)).toEqual([
      'warning',
    ]);
  });
  it('honors allowOnly in the project that runs the file', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': `export default { test: { allowOnly: false, projects: [
        { test: { name: 'paper', include: ['tests/paper.test.ts'], allowOnly: true } },
        { test: { name: 'live', include: ['tests/live.test.ts'], allowOnly: false } },
      ] } };`,
      'tests/paper.test.ts': "import { test } from 'vitest'; test.only('opens a paper order', () => {});",
      'tests/live.test.ts': "import { test } from 'vitest'; test.only('opens a live order', () => {});",
    });
    const result = await scan({ root, framework: 'vitest' });
    expect(
      result.diagnostics
        .filter(({ code }) => code === 'forbidden-only')
        .map(({ relativeFilePath }) => relativeFilePath),
    ).toEqual(['tests/live.test.ts']);
  });

  it('does not fail a focused test in an unconditionally skipped describe', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': 'export default { test: { allowOnly: false } };',
      'tests/paper.test.ts':
        "import { test, describe } from 'vitest'; describe.skip('paper venue', () => { test.only('opens a paper order', () => {}); });",
    });
    const result = await scan({ root, framework: 'vitest' });
    expect(result.diagnostics.filter(({ code }) => code === 'forbidden-only')).toEqual([]);
  });
  it.each(['each', 'for'])('rejects a modifier after %s has already been called', (table) => {
    const inventory = scanVitest(`import { test } from 'vitest';
test.${table}([100]).skip('fills %i shares', () => {});`);
    expect(inventory.diagnostics.some(({ code }) => code === 'invalid-chain')).toBe(true);
    expect(inventory.tests[0].state).toBe('notLoaded');
  });
});

describe.each([
  ['node:test', scanNode, "it.concurrent('quotes the ask', () => {});", 'active'],
  ['bun:test', scanBun, "it.each(5)('quotes the ask', () => {});", 'notLoaded'],
] as const)('%s describe failure scope', (runner, read, refused, earlier) => {
  it('keeps tests outside a describe whose callback fails', () => {
    const inventory = read(`import { describe, it } from '${runner}';
describe('quotes', () => {
  it('quotes the bid', () => {});
  ${refused}
  it('quotes the mid', () => {});
  ${refused}
});
it('opens an order ticket', () => {});`);
    expect(inventory.tests.find(({ title }) => title === 'quotes the bid')?.state).toBe(earlier);
    expect(inventory.tests.find(({ title }) => title === 'quotes the mid')?.state).toBe('notLoaded');
    expect(inventory.tests.find(({ title }) => title === 'opens an order ticket')?.state).toBe('active');
  });
});

describe('Mocha focus regressions', () => {
  it('keeps only a focused test inside a focused suite', () => {
    const inventory = scanMocha(`describe.only('fills', () => {
  it.only('books a partial fill', () => {});
  it('books a full fill', () => {});
  describe.only('fees', () => { it('charges commission', () => {}); });
});`);
    expect(inventory.tests.map(({ isOnly }) => isOnly)).toEqual([true, false, false]);
  });

  it('lets a focused inner suite replace its outer focus', () => {
    const inventory = scanMocha(`describe.only('fills', () => {
  it('books a full fill', () => {});
  describe.only('fees', () => { it('charges commission', () => {}); });
});`);
    expect(inventory.tests.map(({ isOnly }) => isOnly)).toEqual([false, true]);
  });

  it('lets a focused root test exclude focused suites in other files', async () => {
    const root = project({
      'tests/orders.test.js': "it.only('books a market fill', () => {});",
      'tests/fees.test.js': "describe.only('fees', () => { it('charges commission', () => {}); });",
    });
    const inventory = await scan({ root, framework: 'mocha', patterns: ['tests/*.test.js'] });
    expect(inventory.tests.filter(({ isOnly }) => isOnly).map(({ title }) => title)).toEqual(['books a market fill']);
  });
});

describe('config dependency regressions', () => {
  it.each([
    [
      'cypress',
      'cypress.config.ts',
      'export default { e2e: {} };',
      'cypress/support/e2e.ts',
      "it('opens an order ticket', () => {});",
    ],
    [
      'jasmine',
      'spec/support/jasmine.json',
      '{"spec_dir":"spec","spec_files":["**/*.spec.js"],"helpers":["helpers/**/*.js"]}',
      'spec/helpers/venue.js',
      "it('opens an order ticket', () => {});",
    ],
    [
      'vitest',
      'vitest.config.ts',
      "export default { resolve: { alias: { '@desk': '/src' } }, test: { setupFiles: ['@desk/setup.ts'] } };",
      'src/setup.ts',
      "import { test } from 'vitest'; test('opens an order ticket', () => {});",
    ],
  ] as const)('includes %s setup files in dependencies', async (framework, config, settings, setup, code) => {
    const root = project({ [config]: settings, [setup]: 'globalThis.venue = "paper";', 'spec/orders.spec.js': code });
    const result = await scan({ root, framework, patterns: ['spec/*.spec.js'] });
    expect(result.tests[0].dependencies).toContain(setup);
  });

  it('includes every Node.js script preload in dependencies', async () => {
    const root = project({
      'package.json': JSON.stringify({
        scripts: {
          test: 'node --import ./setup/session.js --require=./setup/clock.js --test-global-setup ./setup/venue.js --test tests/*.test.js',
        },
      }),
      'setup/session.js': 'globalThis.session = "paper";',
      'setup/clock.js': 'globalThis.clock = 100;',
      'setup/venue.js': 'export function globalSetup() {}',
      'tests/quotes.test.js': "import { it } from 'node:test'; it('opens an order ticket', () => {});",
    });
    const result = await scan({ root, framework: 'node' });
    expect(result.tests[0].dependencies).toEqual(
      expect.arrayContaining(['setup/session.js', 'setup/clock.js', 'setup/venue.js']),
    );
  });

  it('marks a missing Node.js preload and leaves installed preload packages out', async () => {
    const root = project({
      'package.json': JSON.stringify({
        scripts: { test: 'node --import setup-package --require ./missing-setup.js --test tests/*.test.js' },
      }),
      'tests/orders.test.js': "import { it } from 'node:test'; it('opens a paper order', () => {});",
    });
    const result = await scan({ root, framework: 'node' });
    expect(result.tests[0].hasUnfollowedDependencies).toBe(true);
    expect(result.diagnostics.some(({ message }) => message.includes('missing-setup.js'))).toBe(true);
  });

  it('marks an unreadable config alias in setupFiles as unfollowed', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts':
        "export default { resolve: { alias: { '@desk': process.env.SETUP_ROOT } }, test: { setupFiles: ['@desk/setup'] } };",
      'tests/orders.test.ts': "import { test } from 'vitest'; test('opens a paper order', () => {});",
    });
    const result = await scan({ root, framework: 'vitest' });
    expect(result.tests[0].hasUnfollowedDependencies).toBe(true);
  });
  it.each([
    "{ 'pricing-engine': process.env.PRICING_ROOT }",
    "[{ find: 'pricing-engine', replacement: process.env.PRICING_ROOT }]",
    "{ ...makePricingAliases(), unrelated: '/src/unrelated' }",
    "{ 'pricing-engine': process.env.PRICING_ROOT + '/src' }",
    "{ 'pricing-engine': `${process.env.PRICING_ROOT}/src` }",
    'makePricingAliases()',
  ])('marks dependencies through an unreadable alias: %s', async (alias) => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': `export default { resolve: { alias: ${alias} } };`,
      'tests/quotes.test.ts': `import { test, expect } from 'vitest';
import { mid } from 'pricing-engine';
test('quotes the mid price', () => expect(mid(10, 12)).toBe(11));`,
    });
    const result = await scan({ root, framework: 'vitest', patterns: ['tests/*.test.ts'] });
    expect(result.tests[0].hasUnfollowedDependencies).toBe(true);
    expect(result.diagnostics.some(({ code }) => code === 'dependency-not-followed')).toBe(true);
  });

  it.each(["__dirname + '/src'", '`${__dirname}/src`', "(1 + '/src')", '(1 + 2)'])(
    'reads a config path built with %s',
    async (replacement) => {
      const root = project({
        'package.json': VITEST_PACKAGE,
        'vitest.config.ts': `export default { resolve: { alias: { 'pricing-engine': ${replacement} } } };`,
        'src/index.ts': 'export const mid = (bid, ask) => (bid + ask) / 2;',
        'tests/1/src/index.ts': 'export const mid = (bid, ask) => (bid + ask) / 2;',
        'tests/quotes.test.ts': `import { test, expect } from 'vitest';
import { mid } from 'pricing-engine';
test('quotes the mid price', () => expect(mid(10, 12)).toBe(11));`,
      });
      const result = await scan({ root, framework: 'vitest', patterns: ['tests/*.test.ts'] });
      if (replacement === '(1 + 2)' || replacement === "(1 + '/src')") {
        expect(result.tests[0].hasUnfollowedDependencies).toBe(true);
      } else {
        expect(result.tests[0].dependencies.some((file) => file.endsWith('src/index.ts'))).toBe(true);
        expect(result.tests[0].hasUnfollowedDependencies).toBe(false);
      }
    },
  );

  it('includes Bun preload files in the dependencies of its tests', async () => {
    const root = project({
      'package.json': JSON.stringify({ scripts: { test: 'bun test' }, devDependencies: { bun: '1.4.4' } }),
      'bunfig.toml': '[test]\npreload = ["./tests/setup.ts"]\n',
      'tests/setup.ts': 'globalThis.exchangeSession = "paper";',
      'tests/quotes.test.ts': `import { test, expect } from 'bun:test';
test('opens the paper session', () => expect(globalThis.exchangeSession).toBe('paper'));`,
    });
    const result = await scan({ root, framework: 'bun', patterns: ['tests/*.test.ts'] });
    expect(result.tests[0].dependencies).toContain('tests/setup.ts');
  });
});
