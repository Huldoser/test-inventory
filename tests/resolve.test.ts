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
      'is not a local file, a path alias or a workspace package',
    ],
    ['no tsconfig', {}, '@/fixtures', 'is not a local file, a path alias or a workspace package'],
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
  ])('is followed to its source through %s', async (_, manifest, from) => {
    const root = workspace(manifest, { 'tests/portfolio.spec.ts': spec(from) });
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(inventory.summary.testCount).toBe(1);
    expect(inventory.diagnostics).toEqual([]);
  });

  it.each([
    ['only built JavaScript', { exports: './dist/index.js', types: './dist/index.d.ts' }, '@trading/test-utils'],
    ['a subpath it does not export', { exports: { '.': './src/index.ts' } }, '@trading/test-utils/fixtures'],
    ['a subpath without exports', { main: './src/index.ts' }, '@trading/test-utils/fixtures'],
  ])('is reported when it points to %s', async (_, manifest, from) => {
    const root = workspace(manifest, { 'tests/portfolio.spec.ts': spec(from) });
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(messages(inventory)).toEqual([
      `'test' is imported from '${from}', which is a workspace package whose exports, types and main don't point to TypeScript source; tests that use it are missing.`,
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
