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
    { second: '', topProjects: [] },
    { second: 'playwright test', topProjects: null },
    { second: 'playwright test orders checks', topProjects: null },
    { second: 'playwright test spec', topProjects: [] },
    { second: 'playwright test balances', topProjects: [] },
  ])(
    'combines location filters without a Playwright config, with a second script "$second"',
    async ({ second, topProjects }) => {
      const root = project({
        'package.json': JSON.stringify({
          devDependencies: { '@playwright/test': '1.65.1' },
          scripts: { orders: 'playwright test orders', ledger: second },
        }),
        'tests/orders.spec.js': `const {test}=require('@playwright/test'); const {check}=require('./checks.cjs');
        check('settles an order'); test.describe('settlement desk', () => check('records a ledger entry'));`,
        'tests/checks.cjs': "const {test}=require('@playwright/test'); exports.check = title => test(title, () => {});",
      });
      const { tests } = await scan({ root });
      expect(tests.map((test) => [test.title, test.projects])).toEqual([
        ['settles an order', topProjects],
        ['records a ledger entry', null],
      ]);
    },
  );

  it.each([
    { usage: "check('top');", expected: [] },
    { usage: "test.describe('orders desk', () => check('nested'));", expected: ['nested', 'seed'] },
    { usage: "check('top'); test.describe('orders desk', () => check('nested'));", expected: ['nested', 'seed'] },
    { usage: "check('top'); test('local', () => {});", expected: ['local', 'seed', 'top'] },
  ])('uses the suite and declaration locations for a filtered entry: $usage', async ({ usage, expected }) => {
    const root = project({
      'package.json': manifest('@playwright/test', '1.65.1', 'playwright test orders'),
      'playwright.config.cjs': `module.exports = {testDir:'tests', projects:[
        {name:'seed',testMatch:'**/*.seed.js'}, {name:'ui',testMatch:'**/*.ui.js',dependencies:['seed']}]};`,
      'tests/orders.ui.js': "const {test}=require('@playwright/test'); const {check}=require('./checks.cjs'); " + usage,
      'tests/checks.cjs':
        "const {test}=require('@playwright/test'); exports.check = title => test.describe('order ledger', () => test(title, () => {}));",
      'tests/session.seed.js': "const {test}=require('@playwright/test'); test('seed', () => {});",
    });
    const inventory = await scan({ root });
    expect(
      inventory.tests
        .filter((test) => test.projects?.length)
        .map((test) => test.title)
        .sort(),
    ).toEqual(expected);
  });

  it.each([
    { selected: 'module.exports = {};', seed: false },
    { selected: "import { test } from '@playwright/test';", seed: false },
    { selected: "const {test} = require('@playwright/test'); test.beforeEach(() => {});", seed: false },
    { selected: "require('./register.js').orders();", seed: true },
    { selected: "require('./side-effect.js');", seed: true },
    { selected: "const entry = './side-effect.cjs'; require(entry);", seed: true },
    { selected: "await import('./side-effect.cjs');", seed: true },
    { selected: 'export const order = {', seed: true },
    { selected: "require('./ledger-util.cjs');", seed: false },
    { selected: "import './reexport.mjs';", seed: true },
    { selected: "import './rates.mjs';", seed: false },
    { selected: "import './missing-rate.mjs';", seed: true },
    { selected: "import './invalid-rate.mjs';", seed: true },
    { selected: "require('ledger-registration-plugin');", seed: true },
    { selected: "const {test} = require('@playwright/test'); test('settles the order');", seed: true },
  ])('collects prerequisites according to what the selected spec registers: $selected', async ({ selected, seed }) => {
    const root = project({
      'package.json': manifest('@playwright/test', '1.65.1', 'playwright test orders'),
      'playwright.config.cjs': `module.exports = {testDir:'tests', projects:[
        {name:'seed',testMatch:'**/*.seed.js'}, {name:'ui',testMatch:'**/*.ui.js',dependencies:['seed']},
        {name:'ledger',testMatch:'**/*.spec.js'}]};`,
      'tests/orders.ui.js': selected,
      'tests/orders.spec.js': playwrightOrder,
      'tests/session.seed.js': playwrightOrder,
      'tests/register.js': `exports.orders = () => { ${playwrightOrder} };`,
      'tests/side-effect.js': playwrightOrder,
      'tests/side-effect.cjs': playwrightOrder,
      'tests/ledger-util.cjs': 'exports.fee = 2;',
      'tests/reexport.mjs': "export {} from './side-effect.js';",
      'tests/rates.mjs': "export {fee} from './ledger-util.cjs';",
      'tests/missing-rate.mjs': "export * from './absent.mjs';",
      'tests/invalid-rate.mjs': 'export const rate = {',
    });
    const inventory = await scan({ root });
    const paths = inventory.tests.map((test) => test.relativeFilePath);
    expect(paths).toContain('tests/orders.spec.js');
    expect(paths.includes('tests/session.seed.js')).toBe(seed);
  });

  it.each([
    ['grep: /settles/', true],
    ['grep: /cancelled/', false],
    ['grepInvert: /cancelled/', true],
    ['grepInvert: /settles/', false],
    ['grep: /ui orders.ui.js settlement desk settles the order @smoke/', true],
  ] as const)('uses project title selection before including prerequisites with %s', async (filter, seeded) => {
    const root = project({
      'package.json': manifest('@playwright/test', '1.65.1', 'playwright test orders'),
      'playwright.config.cjs': `module.exports = { testDir: 'tests', projects: [
        { name: 'seed', testMatch: '**/*.seed.js' },
        { name: 'ui', testMatch: '**/*.ui.js', dependencies: ['seed'], ${filter} }
      ]};`,
      'tests/orders.ui.js': `const {test} = require('@playwright/test');
        test.describe('settlement desk', {tag: '@smoke'}, () => {test('settles the order', () => {});});`,
      'tests/session.seed.js': playwrightOrder,
    });
    const { tests } = await scan({ root });
    const ui = tests.find((test) => test.relativeFilePath === 'tests/orders.ui.js');
    expect(ui?.projects).toEqual(seeded ? ['ui'] : []);
    expect(tests.some((test) => test.relativeFilePath === 'tests/session.seed.js')).toBe(seeded);
  });

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

describe('Playwright module initialization across spec files', () => {
  it.each([
    { reverseProjects: false, commands: ['playwright test'], owners: ['orders-a'] },
    { reverseProjects: true, commands: ['playwright test orders'], owners: ['orders-z'] },
    {
      reverseProjects: false,
      commands: ['playwright test orders-a', 'playwright test orders-z'],
      owners: ['orders-a', 'orders-z'],
    },
    {
      reverseProjects: false,
      commands: ['playwright test orders', 'playwright test orders-z'],
      owners: ['orders-a', 'orders-z'],
    },
    { reverseProjects: true, commands: ['playwright test orders', 'playwright test orders-z'], owners: ['orders-z'] },
  ])(
    'keeps one initialization per process for $commands with reversed projects=$reverseProjects',
    async ({ reverseProjects, commands, owners }) => {
      const projects = ['orders-a', 'orders-z'].map((name) => ({ name, testMatch: '**/' + name + '.spec.cjs' }));
      if (reverseProjects) projects.reverse();
      const root = project({
        'package.json': JSON.stringify({
          devDependencies: { '@playwright/test': '1.65.1' },
          scripts: Object.fromEntries(commands.map((command, i) => ['ledger' + String(i), command])),
        }),
        'playwright.config.cjs': 'module.exports=' + JSON.stringify({ testDir: 'tests', projects }),
        'tests/orders-a.spec.cjs': "require('./ledger.cjs').settle();",
        'tests/orders-z.spec.cjs': "require('./ledger.cjs').settle();",
        'tests/ledger.cjs': `const {test}=require('@playwright/test');
        test('registers the exchange rate', () => {}); exports.settle = () => test('settles a trade', () => {});`,
      });
      const { tests } = await scan({ root });
      const specsFor = (title: string) =>
        tests.filter((test) => test.title === title).map((test) => test.relativeFilePath);
      expect(specsFor('settles a trade')).toEqual(['tests/orders-a.spec.cjs', 'tests/orders-z.spec.cjs']);
      expect(specsFor('registers the exchange rate')).toEqual(owners.map((name) => 'tests/' + name + '.spec.cjs'));
    },
  );
  it('initializes only modules still new to either overlapping command', async () => {
    const root = project({
      'package.json': JSON.stringify({
        devDependencies: { '@playwright/test': '1.65.1' },
        scripts: {
          orders: 'playwright test orders',
          market: 'playwright test market',
        },
      }),
      'playwright.config.cjs': "module.exports={testDir:'tests'};",
      'tests/a-orders.spec.cjs': "require('./prices.cjs');require('./fees.cjs');",
      'tests/b-market.spec.cjs': "require('./fees.cjs');",
      'tests/z-orders-market.spec.cjs': "require('./prices.cjs');require('./fees.cjs');",
      'tests/prices.cjs': "require('@playwright/test').test('quotes a price',()=>{});",
      'tests/fees.cjs': "require('@playwright/test').test('charges a fee',()=>{});",
    });
    const { tests } = await scan({ root });
    expect(
      tests.filter((test) => test.relativeFilePath.endsWith('z-orders-market.spec.cjs')).map((test) => test.title),
    ).toEqual(['quotes a price']);
  });

  it.each([false, true])('starts the setup project when the later spec registers a local test=%s', async (local) => {
    const root = project({
      'package.json': manifest('@playwright/test', '1.65.1', 'playwright test orders'),
      'playwright.config.cjs':
        'module.exports=' +
        JSON.stringify({
          testDir: 'tests',
          projects: [
            { name: 'early', testMatch: '**/orders-alpha.spec.cjs' },
            { name: 'late', testMatch: '**/orders-zulu.spec.cjs', dependencies: ['seed'] },
            { name: 'seed', testMatch: '**/*.seed.cjs' },
          ],
        }),
      'tests/orders-alpha.spec.cjs': "require('./register.cjs');",
      'tests/orders-zulu.spec.cjs': "require('./register.cjs');" + (local ? playwrightOrder : ''),
      'tests/register.cjs': playwrightOrder,
      'tests/ledger.seed.cjs': playwrightOrder,
    });
    const { tests } = await scan({ root });
    expect(tests.map((test) => test.relativeFilePath)).toEqual(
      local
        ? ['tests/ledger.seed.cjs', 'tests/orders-alpha.spec.cjs', 'tests/orders-zulu.spec.cjs']
        : ['tests/orders-alpha.spec.cjs'],
    );
  });
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
    ['false && cd desk;', 'tests/orders.spec.js'],
    ['true || cd desk;', 'tests/orders.spec.js'],
    ['cd desk && true || cd ..;', 'desk/tests/orders.spec.js'],
    [': || cd desk;', 'tests/orders.spec.js'],
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
    ['test/[!a].js', ['test/[a].js', 'test/a.js', 'test/account.js']],
    ['test/[a].js', ['test/[a].js', 'test/account.js', 'test/b.js']],
    ['test/!(a).js', ['test/a.js']],
    ['!test/a.js', ['test/a.js']],
    ['!!test/a.js', ['test/[a].js', 'test/account.js', 'test/b.js']],
    ['#test/*.js', ['test/[a].js', 'test/a.js', 'test/account.js', 'test/b.js']],
  ] as const)('matches the Mocha ignore expression %s', async (ignore, expected) => {
    const root = project({
      'package.json': manifest('mocha', '12.0.3', "mocha 'test/*.js'"),
      '.mocharc.json': JSON.stringify({ ignore }),
      ...testSources(['test/[a].js', 'test/a.js', 'test/b.js', 'test/account.js']),
    });
    await expectFiles(root, [...expected]);
  });

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

describe('Mocha character classes and extension values', () => {
  it.each([
    { spec: 'test/[a].js', expected: ['test/a.js.cjs', 'test/fees.js'] },
    { spec: 'test/[!a].js', expected: ['test/b.js', 'test/fees.js'] },
    { spec: 'test/!(a).js', expected: ['test/ab.js', 'test/b.js', 'test/fees.js'] },
    { spec: 'test/{a,b}/../a.js', expected: ['test/a.js.cjs', 'test/fees.js'] },
  ])('collects the files selected by $spec', async ({ spec, expected }) => {
    const root = project({
      'package.json': manifest('mocha', '12.0.3', `mocha test/fees.js '${spec}'`),
      ...testSources(['test/a.js', 'test/a.js.cjs', 'test/b.js', 'test/ab.js', 'test/fees.js']),
    });
    await expectFiles(root, expected);
  });
  it('preserves whitespace at the end of the last configured extension', async () => {
    const root = project({
      'package.json': manifest('mocha', '12.0.3', 'mocha test/fees.js test/orders'),
      '.mocharc.json': JSON.stringify({ extension: 'js,cjs ' }),
      ...testSources(['test/fees.js', 'test/orders.js', 'test/orders.cjs']),
    });
    await expectFiles(root, ['test/fees.js', 'test/orders.js']);
  });
});
