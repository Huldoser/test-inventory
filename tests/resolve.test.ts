import { mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, scanSource, type Framework } from '../src/index.ts';
import { parseJsonc } from '../src/resolve.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

const FIXTURES = "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n";
const VITEST_FIXTURES =
  "import { test as base } from 'vitest';\nexport const test = base.extend({ broker: 'paper' });\n";

function spec(from: string): string {
  return `import { test } from '${from}';\ntest('shows the buying power', async ({ page }) => {});\n`;
}

async function scanSpec(files: Record<string, string>, framework: Framework = 'playwright') {
  const root = project(files);
  return scan({ root, patterns: ['tests/**/*.{spec,test}.ts'], framework });
}

function messages(inventory: { diagnostics: { message: string }[] }): string[] {
  return inventory.diagnostics.map((diagnostic) => diagnostic.message);
}

/** Links a folder into node_modules, as npm, pnpm and Yarn workspaces do. Junctions need no extra rights on Windows. */
function link(root: string, name: string, target: string): void {
  mkdirSync(path.dirname(path.join(root, 'node_modules', name)), { recursive: true });
  symlinkSync(path.join(root, target), path.join(root, 'node_modules', name), 'junction');
}

describe('a custom test object imported through a tsconfig path alias', () => {
  const base = {
    'package.json': PLAYWRIGHT_PACKAGE,
    'fixtures/index.ts': FIXTURES,
    'tsconfig.json': `{
  // Shared settings live in config/.
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": ["@tsconfig/node22/tsconfig.json", "./config/tsconfig.base"],
  "compilerOptions": { "strict": true, },
}
`,
  };

  it('is followed with paths relative to the tsconfig that sets them, and with baseUrl', async () => {
    const inventory = await scanSpec({
      ...base,
      'config/tsconfig.base.json':
        '{ "compilerOptions": { "paths": { "@/*": ["../*"], "@/fixtures/*": ["../missing/*"] } } }',
      'tests/portfolio.spec.ts': spec('@/fixtures'),
    });
    expect(inventory.tests.map((test) => test.title)).toEqual(['shows the buying power']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('prefers the pattern with the longest prefix, and an exact name over a pattern', async () => {
    const inventory = await scanSpec({
      ...base,
      'config/tsconfig.base.json':
        '{ "compilerOptions": { "baseUrl": "..", "paths": { "@app/*": ["missing/*"], "@app/fixtures/*": ["fixtures/*"], "@app/f*": ["missing/*"], "@app/fixtures": ["fixtures/index.ts"], "*/*/*": ["x"], "@app/*.json": ["x"] } } }',
      'tests/portfolio.spec.ts': spec('@app/fixtures/index'),
      'tests/watchlist.spec.ts': spec('@app/fixtures'),
    });
    expect(inventory.summary.testCount).toBe(2);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('falls back to installed packages when no file of a matching alias exists, as TypeScript does', async () => {
    const inventory = await scanSpec(
      {
        'package.json': VITEST_PACKAGE,
        'node_modules/vitest/package.json': '{ "name": "vitest" }',
        'node_modules/decimal.js/package.json': '{ "name": "decimal.js" }',
        'tsconfig.json': '{ "compilerOptions": { "paths": { "*": ["./src/types/*"] } } }',
        'src/types/money.ts': "export const CURRENCY = 'USD';\n",
        'tests/fees.test.ts': `import { expect, test } from 'vitest';
import Decimal from 'decimal.js';
import { CURRENCY } from 'money';

test('charges the commission in the account currency', () => {
  expect(new Decimal(1.5).toFixed(2) + CURRENCY).toBe('1.50USD');
});
`,
      },
      'vitest',
    );
    expect(inventory.tests[0]).toMatchObject({
      dependencies: ['src/types/money.ts', 'tests/fees.test.ts'],
      hasUnfollowedDependencies: false,
    });
    expect(inventory.diagnostics).toEqual([]);
  });

  it('is followed through baseUrl alone', async () => {
    const inventory = await scanSpec({
      'package.json': PLAYWRIGHT_PACKAGE,
      'fixtures/index.ts': FIXTURES,
      'tsconfig.json': '{ "extends": "./tsconfig.base.json" }',
      'tsconfig.base.json': '{ "compilerOptions": { "baseUrl": "." } }',
      'tests/portfolio.spec.ts': spec('fixtures'),
    });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it.each([
    [
      'an alias whose file is missing',
      { 'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }' },
      '@/fixtures',
      'could not be read',
    ],
    [
      'an unknown name, with baseUrl',
      { 'tsconfig.json': '{ "compilerOptions": { "baseUrl": "." } }' },
      '@trading/test-utils',
      'is not a local file, a path alias or a workspace package',
    ],
    [
      'a tsconfig that is not JSON',
      { 'tsconfig.json': '{ "compilerOptions": ' },
      '@/fixtures',
      'is a path alias that no tsconfig paths define',
    ],
    ['no tsconfig', {}, '@/fixtures', 'is a path alias that no tsconfig paths define'],
    ['no tsconfig, for a name no package can have', {}, '~/fixtures', 'is a path alias that no tsconfig paths define'],
  ])('is reported with %s', async (_, files, from, reason) => {
    const inventory = await scanSpec({
      'package.json': PLAYWRIGHT_PACKAGE,
      ...files,
      'tests/portfolio.spec.ts': spec(from),
    });
    expect(inventory.tests).toEqual([]);
    expect(messages(inventory)).toEqual([
      `'test' is imported from '${from}', which ${reason}; tests that use it are missing.`,
    ]);
  });
});

describe('the tsconfig, found the way TypeScript finds it', () => {
  it('is the nearest one above the test file', async () => {
    const inventory = await scanSpec({
      'package.json': PLAYWRIGHT_PACKAGE,
      'fixtures/index.ts': FIXTURES,
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["missing/*"] } } }',
      'tests/tsconfig.json':
        '{ "extends": "../tsconfig.json", "compilerOptions": { "paths": { "@/*": ["../fixtures/*"] } } }',
      'tests/portfolio.spec.ts': spec('@/index'),
      'tests/orders/limit-orders.spec.ts': spec('@/index'),
    });
    expect(inventory.summary.testCount).toBe(2);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('extends packages by name and by file, through further extends, with ${configDir} filled in', async () => {
    const inventory = await scanSpec({
      'package.json': PLAYWRIGHT_PACKAGE,
      'fixtures/index.ts': FIXTURES,
      'node_modules/@trading/tsconfig/package.json': '{ "name": "@trading/tsconfig", "tsconfig": "./base.json" }',
      'node_modules/@trading/tsconfig/base.json': '{ "extends": "./aliases", "compilerOptions": { "strict": true } }',
      'node_modules/@trading/tsconfig/aliases.json':
        '{ "compilerOptions": { "paths": { "@trading/fixtures": ["${configDir}/fixtures/index.ts"] } } }',
      'node_modules/@trading/strict/tsconfig.json': '{ "compilerOptions": { "strict": true } }',
      'tsconfig.json': '{ "extends": ["@trading/strict", "@trading/tsconfig", "@trading/tsconfig/aliases"] }',
      'tests/portfolio.spec.ts': spec('@trading/fixtures'),
    });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('is tsconfig.base.json when there is no tsconfig.json, as in an Nx workspace', async () => {
    const inventory = await scanSpec({
      'package.json': PLAYWRIGHT_PACKAGE,
      'libs/testing/src/index.ts': FIXTURES,
      'tsconfig.base.json': '{ "compilerOptions": { "paths": { "@trading/testing": ["libs/testing/src/index.ts"] } } }',
      'tests/portfolio.spec.ts': spec('@trading/testing'),
    });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('takes paths from the first project a solution-style tsconfig references that sets them', async () => {
    const inventory = await scanSpec({
      'package.json': PLAYWRIGHT_PACKAGE,
      'fixtures/index.ts': FIXTURES,
      'tsconfig.json':
        '{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./config" }, { "path": 1 }, { "path": "./tsconfig.app.json" }] }',
      'tsconfig.node.json': '{ "compilerOptions": { "strict": true } }',
      'config/README.md': 'No tsconfig here.\n',
      'tsconfig.app.json': '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
      'tests/portfolio.spec.ts': spec('@/fixtures'),
    });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads each project once when solution-style tsconfigs reference each other', async () => {
    const inventory = await scanSpec({
      'package.json': PLAYWRIGHT_PACKAGE,
      'fixtures/index.ts': FIXTURES,
      'tsconfig.json': '{ "files": [], "references": [{ "path": "./apps/web" }, { "path": "./tsconfig.e2e.json" }] }',
      'apps/web/tsconfig.json': '{ "references": [{ "path": "../.." }, { "path": "../../tsconfig.json" }] }',
      'tsconfig.e2e.json': '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
      'tests/portfolio.spec.ts': spec('@/fixtures'),
    });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads a tsconfig that extends itself once, and skips files it extends that are missing', async () => {
    const inventory = await scanSpec({
      'package.json': PLAYWRIGHT_PACKAGE,
      'fixtures/index.ts': FIXTURES,
      'tsconfig.json':
        '{ "extends": ["./tsconfig.json", "./missing.json", "./missing"], "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
      'tests/portfolio.spec.ts': spec('@/fixtures'),
    });
    expect(inventory.summary.testCount).toBe(1);
  });
});

describe('a custom test object imported through package.json imports', () => {
  it.each([
    ['a path', { '#fixtures': './fixtures/index.ts' }, '#fixtures'],
    ['a pattern', { '#fixtures/*': './fixtures/*.ts' }, '#fixtures/index'],
    [
      'conditions, falling back from .js to .ts',
      { '#fixtures': { types: './fixtures/index.d.ts', default: './fixtures/index.js' } },
      '#fixtures',
    ],
    ['a list of targets', { '#fixtures': ['./fixtures/index.ts'] }, '#fixtures'],
  ])('is followed through %s', async (_, imports, from) => {
    const inventory = await scanSpec({
      'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.63.0' }, imports }),
      'fixtures/index.ts': FIXTURES,
      'tests/portfolio.spec.ts': spec(from),
    });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it.each([
    [
      'a name that is not in imports',
      { imports: { '#pages': './pages/index.ts' } },
      '#fixtures',
      'is not in the imports of package.json',
    ],
    ['a package.json without imports', {}, '#fixtures', 'is not in the imports of package.json'],
    ['a target that is missing', { imports: { '#fixtures': './missing.ts' } }, '#fixtures', 'could not be read'],
  ])('is reported for %s', async (_, manifest, from, reason) => {
    const inventory = await scanSpec({
      'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.63.0' }, ...manifest }),
      'tests/portfolio.spec.ts': spec(from),
    });
    expect(messages(inventory)).toEqual([
      `'test' is imported from '${from}', which ${reason}; tests that use it are missing.`,
    ]);
  });

  it('is followed through a pattern whose target repeats the star, as Node fills in each one', async () => {
    const inventory = await scanSpec({
      'package.json': JSON.stringify({
        devDependencies: { '@playwright/test': '1.63.0' },
        imports: { '#desks/*': './desks/*/*-fixtures.ts' },
      }),
      'desks/equities/equities-fixtures.ts': FIXTURES,
      'tests/portfolio.spec.ts': spec('#desks/equities'),
    });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('is reported when no package.json is found above the file', async () => {
    const inventory = await scanSpec({ 'tests/portfolio.spec.ts': spec('#fixtures') }, 'playwright');
    expect(messages(inventory)).toContain(
      "'test' is imported from '#fixtures', which is not in the imports of package.json; tests that use it are missing.",
    );
  });
});

describe('a custom test object from a workspace package', () => {
  const workspace = (manifest: object, files: Record<string, string> = {}) => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'packages/test-utils/package.json': JSON.stringify({ name: '@trading/test-utils', ...manifest }),
      'packages/test-utils/src/index.ts': FIXTURES,
      'packages/test-utils/src/fixtures.ts': FIXTURES,
      ...files,
    });
    link(root, '@trading/test-utils', 'packages/test-utils');
    return root;
  };

  it.each([
    [
      'exports with conditions',
      { exports: { '.': { types: './src/index.ts', import: './dist/index.js' } } },
      '@trading/test-utils',
    ],
    ['exports as a string', { exports: './src/index.ts' }, '@trading/test-utils'],
    ['exports as conditions only', { exports: { import: './src/index.ts' } }, '@trading/test-utils'],
    ['types', { types: './src/index.ts' }, '@trading/test-utils'],
    ['main', { main: './src/index.ts' }, '@trading/test-utils'],
    [
      'a subpath export',
      { exports: { '.': './dist/index.js', './fixtures': './src/fixtures.ts' } },
      '@trading/test-utils/fixtures',
    ],
    ['a subpath pattern', { exports: { './*': './src/*.ts' } }, '@trading/test-utils/fixtures'],
    [
      'build output, to the source next to it',
      { exports: { '.': { types: './dist/types/index.d.ts', import: './dist/esm/index.js' } } },
      '@trading/test-utils',
    ],
    ['a built main, to the source next to it', { main: './lib/fixtures.cjs' }, '@trading/test-utils'],
  ])('is followed to its source through %s', async (_, manifest, from) => {
    const root = workspace(manifest, { 'tests/portfolio.spec.ts': spec(from) });
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('is followed through a subpath pattern whose target repeats the star, as Node fills in each one', async () => {
    const root = workspace(
      { exports: { './*': './src/*/*-fixtures.ts' } },
      {
        'packages/test-utils/src/equities/equities-fixtures.ts': FIXTURES,
        'tests/portfolio.spec.ts': spec('@trading/test-utils/equities'),
      },
    );
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it.each([
    [
      'only built JavaScript with no source next to it',
      { exports: './dist/bundle.js', types: './build', main: 'index.js' },
      '@trading/test-utils',
    ],
    ['a subpath it does not export', { exports: { '.': './src/index.ts' } }, '@trading/test-utils/fixtures'],
    ['a subpath without exports', { main: './src/index.ts' }, '@trading/test-utils/fixtures'],
  ])('is reported when it points to %s', async (_, manifest, from) => {
    const root = workspace(manifest, { 'tests/portfolio.spec.ts': spec(from) });
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(messages(inventory)).toEqual([
      `'test' is imported from '${from}', which is a workspace package whose exports, types and main don't point to TypeScript source; tests that use it are missing.`,
    ]);
  });

  const WORKSPACE = {
    'packages/test-utils/package.json': JSON.stringify({ name: '@trading/test-utils', exports: './src/index.ts' }),
    'packages/test-utils/src/index.ts': FIXTURES,
    'packages/legacy/package.json': JSON.stringify({ name: '@trading/legacy-utils', exports: './index.ts' }),
    'packages/notes/package.json': '{}',
  };
  const withWorkspaces = (workspaces: unknown) =>
    JSON.stringify({ devDependencies: { '@playwright/test': '1.63.0' }, workspaces });

  it.each([
    ['package.json workspaces', { 'package.json': withWorkspaces(['packages/*', '!packages/legacy']) }],
    ['package.json workspaces.packages', { 'package.json': withWorkspaces({ packages: ['packages/*/'] }) }],
    [
      'a pnpm-workspace.yaml list',
      {
        'package.json': PLAYWRIGHT_PACKAGE,
        'pnpm-workspace.yaml':
          '# Trading monorepo\npackages:\n  - \'packages/*\'\n  # Tools come later.\n  - "tools/*" # with comments\n\ncatalog:\n  vitest: 5.0.3\n',
      },
    ],
    [
      'a pnpm-workspace.yaml flow list',
      { 'package.json': PLAYWRIGHT_PACKAGE, 'pnpm-workspace.yaml': "packages: ['packages/*', tools/*]\n" },
    ],
    [
      'a pnpm-workspace.yaml next to a package.json list kept from before a move to pnpm',
      { 'package.json': withWorkspaces(['apps/*']), 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n' },
    ],
  ])('is followed without an install, from %s', async (_, files) => {
    const inventory = await scanSpec({
      ...WORKSPACE,
      ...files,
      'tests/portfolio.spec.ts': spec('@trading/test-utils'),
      'tests/watchlist.spec.ts': spec('@trading/test-utils'),
    });
    expect(inventory.summary.testCount).toBe(2);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reports a package the workspace leaves out or does not have', async () => {
    const inventory = await scanSpec({
      ...WORKSPACE,
      'package.json': withWorkspaces(['packages/*', '!packages/legacy']),
      'tests/legacy.spec.ts': spec('@trading/legacy-utils'),
    });
    expect(messages(inventory)).toEqual([
      "'test' is imported from '@trading/legacy-utils', which is not a local file, a path alias or a workspace package; tests that use it are missing.",
    ]);
  });

  it('does not search outside the workspace folder, through patterns or links', async () => {
    const outside = project({
      'package.json': JSON.stringify({ name: '@trading/quotes', exports: './src/index.ts' }),
      'src/index.ts': FIXTURES,
    });
    const root = project({
      ...WORKSPACE,
      'package.json': withWorkspaces([
        `${path.dirname(outside).replaceAll('\\', '/')}/*`,
        '../*',
        '!../legacy',
        'packages/*',
        'vendor/*',
      ]),
      'tests/portfolio.spec.ts': spec('@trading/test-utils'),
      'tests/quotes.spec.ts': spec('@trading/quotes'),
    });
    mkdirSync(path.join(root, 'vendor'));
    symlinkSync(outside, path.join(root, 'vendor', 'quotes'), 'junction');
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(inventory.summary.testCount).toBe(1);
    expect(messages(inventory)).toEqual([
      "'test' is imported from '@trading/quotes', which is not a local file, a path alias or a workspace package; tests that use it are missing.",
    ]);
  });

  it('reports an installed package, which is not followed, also for a package without a scope', async () => {
    const inventory = await scanSpec({
      'package.json': PLAYWRIGHT_PACKAGE,
      'node_modules/trading-test-utils/package.json': JSON.stringify({ main: './src/index.ts' }),
      'node_modules/trading-test-utils/src/index.ts': FIXTURES,
      'tests/portfolio.spec.ts': spec('trading-test-utils'),
    });
    expect(messages(inventory)).toEqual([
      "'test' is imported from 'trading-test-utils', which is an installed package, which is not followed; tests that use it are missing.",
    ]);
  });

  it('follows a package linked into a node_modules folder above the root, for Vitest too', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'packages/test-utils/package.json': JSON.stringify({ exports: './src/index.ts' }),
      'packages/test-utils/src/index.ts': VITEST_FIXTURES,
      'apps/web/package.json': VITEST_PACKAGE,
      'apps/web/tests/fees.test.ts':
        "import { test } from '@trading/test-utils';\ntest('charges the minimum', ({ broker }) => {});\n",
    });
    link(root, '@trading/test-utils', 'packages/test-utils');
    const inventory = await scan({
      root: path.join(root, 'apps/web'),
      patterns: ['tests/*.test.ts'],
      framework: 'vitest',
    });
    expect(inventory.tests.map((test) => test.title)).toEqual(['charges the minimum']);
    expect(inventory.diagnostics).toEqual([]);
  });
});

describe('a custom test object that scanSource cannot follow', () => {
  it.each([
    ['playwright', '@trading/test-utils', "test('places an order', async ({ page }) => {});"],
    ['playwright', '@/fixtures', "test.describe('orders', () => {});"],
    ['vitest', '#fixtures', "test('charges the minimum', () => {});"],
  ] as const)('is reported for %s from %s', (framework, from, call) => {
    const inventory = scanSource({
      code: `import { test } from '${from}';\n${call}\n`,
      relativeFilePath: framework === 'playwright' ? 'tests/orders.spec.ts' : 'tests/fees.test.ts',
      framework,
    });
    expect(inventory.tests).toEqual([]);
    expect(messages(inventory)).toEqual([
      `'test' is imported from '${from}', which could not be read; tests that use it are missing.`,
    ]);
  });
});

describe('parseJsonc', () => {
  it('reads comments, trailing commas, and // or ,} inside strings', () => {
    expect(
      parseJsonc(
        '{\n  // the schema\n  "$schema": "https://json.schemastore.org/tsconfig", /* block */\n  "note": "a,}b",\n}',
      ),
    ).toEqual({ $schema: 'https://json.schemastore.org/tsconfig', note: 'a,}b' });
  });

  it('returns null for text that is not JSON', () => {
    expect(parseJsonc('{ "compilerOptions": ')).toBeNull();
  });
});
