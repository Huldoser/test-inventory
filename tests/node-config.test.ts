import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { project } from './project.ts';

const SPEC = "import test from 'node:test';\ntest('quotes the spread', () => {});\n";

function files(inventory: Inventory): string[] {
  return [...new Set(inventory.tests.map((test) => test.relativeFilePath))];
}

describe('node:test files', () => {
  const layout = {
    'src/spread.test.js': SPEC,
    'src/spread.test.ts': SPEC,
    'src/rates_test.mjs': SPEC,
    'src/quotes-test.cjs': SPEC,
    'test-fx.js': SPEC,
    'test.js': SPEC,
    'test/fx/cross-rates.js': SPEC,
    'src/spread.spec.js': SPEC,
    'lib/__tests__/book.js': SPEC,
    '.cache/stale.test.js': SPEC,
  };

  it("runs the files Node.js's default patterns match, TypeScript ones from 22.18, outside dot folders", async () => {
    const root = project({
      'package.json': JSON.stringify({ name: 'pricing-service', scripts: { test: 'node --test' } }),
      ...layout,
    });
    const typed = [
      'src/quotes-test.cjs',
      'src/rates_test.mjs',
      'src/spread.test.js',
      'src/spread.test.ts',
      'test-fx.js',
      'test.js',
      'test/fx/cross-rates.js',
    ];
    expect(files(await scan({ root, framework: 'node', frameworkVersion: '22.18.0' }))).toEqual(typed);
    expect(files(await scan({ root, framework: 'node', frameworkVersion: '22.12.0' }))).toEqual(
      typed.filter((file) => !file.endsWith('.ts')),
    );
    expect(files(await scan({ root, framework: 'node', frameworkVersion: '23.6.0' }))).toEqual(typed);
    // Without a pin, the newest rules apply; without a package.json, or a script that runs node --test, the defaults.
    expect(files(await scan({ root, framework: 'node' }))).toEqual(typed);
    expect(files(await scan({ root: project(layout), framework: 'node' }))).toEqual(typed);
    const lint = JSON.stringify({ name: 'pricing-service', scripts: { lint: 'eslint . && prettier --check .' } });
    expect(files(await scan({ root: project({ 'package.json': lint, ...layout }), framework: 'node' }))).toEqual(typed);
    const bare = project({ 'package.json': JSON.stringify({ name: 'pricing-service' }), ...layout });
    expect(files(await scan({ root: bare, framework: 'node' }))).toEqual(typed);
  });

  it("runs the files and globs the script that runs node --test names, and a folder's files from 26.8", async () => {
    const script = "NODE_ENV=test node --import ./register.js --test --test-reporter spec 'src/**/*.spec.js' src";
    const root = project({
      'package.json': JSON.stringify({ name: 'pricing-service', scripts: { test: script } }),
      ...layout,
    });
    expect(files(await scan({ root, framework: 'node', frameworkVersion: '24.11.0' }))).toEqual(['src/spread.spec.js']);
    expect(files(await scan({ root, framework: 'node', frameworkVersion: '26.8.0' }))).toEqual([
      'src/quotes-test.cjs',
      'src/rates_test.mjs',
      'src/spread.spec.js',
      'src/spread.test.js',
      'src/spread.test.ts',
    ]);
  });

  it.each([
    ['node --disable-warning ExperimentalWarning --test --test-coverage-lines 80', 'default'],
    ['node --test src/spread.test.js && node --test test/fx/cross-rates.js', 'two'],
    ['c8 cross-env TZ=UTC node.exe --test=true --test src/spread.test.js', 'one'],
    ['node build.js --test && node --test src/spread.test.js', 'one'],
  ])('reads the files of the node --test commands of a script: %s', async (script, expected) => {
    const root = project({
      'package.json': JSON.stringify({ name: 'pricing-service', scripts: { test: script } }),
      ...layout,
    });
    const found = files(await scan({ root, framework: 'node', frameworkVersion: '24.11.0' }));
    const typed = [
      'src/quotes-test.cjs',
      'src/rates_test.mjs',
      'src/spread.test.js',
      'src/spread.test.ts',
      'test-fx.js',
      'test.js',
      'test/fx/cross-rates.js',
    ];
    expect(found).toEqual(
      expected === 'default'
        ? typed
        : expected === 'two'
          ? ['src/spread.test.js', 'test/fx/cross-rates.js']
          : ['src/spread.test.js'],
    );
  });

  it('finds node:test from a script that runs node --test, and its version from the Node.js the project pins', async () => {
    const manifest = (extra: object) =>
      JSON.stringify({ name: 'pricing-service', scripts: { 'test:unit': 'node --test src/' }, ...extra });
    const nvmrc = await scan({
      root: project({ 'package.json': manifest({}), '.nvmrc': 'v24.11.1\n', 'src/spread.test.js': SPEC }),
    });
    expect([nvmrc.framework, nvmrc.frameworkVersion]).toEqual(['node', '24.11.1']);
    const major = await scan({
      root: project({ 'package.json': manifest({}), '.node-version': '26', 'src/spread.test.js': SPEC }),
    });
    expect(major.frameworkVersion).toBe('26.0.0');
    expect(major.diagnostics.map((item) => item.code)).toEqual(['approximate-framework-version']);
    const volta = await scan({
      root: project({ 'package.json': manifest({ volta: { node: '22.20.0' } }), 'src/spread.test.js': SPEC }),
    });
    expect(volta.frameworkVersion).toBe('22.20.0');
    const floors = await Promise.all(
      ['>=18', '^20.19.0 || >=22.12.0', '^24.11.0 || ^22.12.0', '>=22.0.1'].map(async (range) => {
        const root = project({ 'package.json': manifest({ engines: { node: range } }), 'src/spread.test.js': SPEC });
        return (await scan({ root })).frameworkVersion;
      }),
    );
    expect(floors).toEqual(['22.0.0', '22.12.0', '24.11.0', '22.0.1']);
    const scriptOnly = await scan({
      root: project({
        'package.json': JSON.stringify({ name: 'pricing-service', scripts: { build: 'node build.js --test' } }),
        'src/spread.test.js': SPEC,
      }),
      patterns: ['src/*.js'],
    }).catch((error: unknown) => (error as Error).message);
    expect(scriptOnly).toMatch(/^options\.framework is needed/);
    const unpinned = await scan({
      root: project({
        'package.json': manifest({ engines: { node: '*' } }),
        '.nvmrc': 'lts/*',
        'src/spread.test.js': SPEC,
      }),
    });
    expect(unpinned.frameworkVersion).toBeNull();
    const engines = await scan({
      root: project({ 'package.json': manifest({ engines: { node: '>=22.12' } }), 'src/spread.test.js': SPEC }),
    });
    // Before 26.8, node --test takes the folder src/ as a file, so it runs none.
    expect([engines.frameworkVersion, engines.diagnostics.map((item) => item.message)]).toEqual([
      '22.12.0',
      [
        'Only the range ">=22.12" was found for node:test, so the rules of the newest 22.x release apply.',
        "No patterns were given, and no file in the root matches what node --test runs: Node.js's default patterns, or the files a package.json script gives it.",
      ],
    ]);
  });
});
