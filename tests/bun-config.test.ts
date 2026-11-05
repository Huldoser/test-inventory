import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { project } from './project.ts';

const SPEC = "test('quotes the spread', () => {});\n";
const MANIFEST = JSON.stringify({ name: 'quote-gateway', scripts: { test: 'bun test' } });

function files(inventory: Inventory): string[] {
  return [...new Set(inventory.tests.map((test) => test.relativeFilePath))];
}

describe('Bun files and configs', () => {
  const layout = {
    'src/spread.test.ts': SPEC,
    'src/quotes_test.tsx': SPEC,
    'src/book.spec.mjs': SPEC,
    'src/depth_spec.cts': SPEC,
    'src/feed.test.json': SPEC,
    'src/helpers.ts': SPEC,
    'test/legacy/old.test.js': SPEC,
    '.cache/stale.test.ts': SPEC,
  };

  it('runs the files whose name ends with .test, _test, .spec or _spec, outside dot folders', async () => {
    const inventory = await scan({ root: project({ 'package.json': MANIFEST, ...layout }), framework: 'bun' });
    expect(files(inventory)).toEqual([
      'src/book.spec.mjs',
      'src/depth_spec.cts',
      'src/quotes_test.tsx',
      'src/spread.test.ts',
      'test/legacy/old.test.js',
    ]);
  });

  it("reads bunfig.toml's [test] root, pathIgnorePatterns, retry and concurrentTestGlob", async () => {
    const bunfig = [
      '# The gateway keeps its tests next to the code.',
      '[install]',
      'exact = true',
      '',
      '[test]',
      'root = "src"',
      'retry = 2',
      "pathIgnorePatterns = ['**/depth_*']",
      'concurrentTestGlob = [',
      '  "**/*.spec.*",',
      ']',
    ].join('\n');
    const inventory = await scan({
      root: project({ 'package.json': MANIFEST, 'bunfig.toml': bunfig, ...layout }),
      framework: 'bun',
    });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.retries, test.isParallel])).toEqual([
      ['src/book.spec.mjs', 2, true],
      ['src/quotes_test.tsx', 2, false],
      ['src/spread.test.ts', 2, false],
    ]);
    expect(inventory.configs.map((config) => config.relativeFilePath)).toEqual(['bunfig.toml']);
    const given = await scan({
      root: project({ 'package.json': MANIFEST, 'bunfig.toml': bunfig, ...layout }),
      framework: 'bun',
      patterns: ['src/helpers.ts'],
    });
    expect(files(given)).toEqual(['src/helpers.ts']);
  });

  it("reports a bunfig.toml it can't parse, and globs that aren't strings, which Bun refuses", async () => {
    const broken = await scan({
      root: project({ 'package.json': MANIFEST, 'bunfig.toml': '[test]\nroot = "src\n', ...layout }),
      framework: 'bun',
    });
    expect(broken.diagnostics.map((item) => item.message)).toContain(
      'The config could not be parsed on line 2: The string is not closed, so the scan reads none of its settings.',
    );
    // Bun ignores a root of another type, and refuses globs that aren't strings.
    const wrongRoot = await scan({
      root: project({ 'package.json': MANIFEST, 'bunfig.toml': '[test]\nroot = 3\n', ...layout }),
      framework: 'bun',
    });
    expect(files(wrongRoot)).toHaveLength(5);
    for (const key of ['pathIgnorePatterns', 'concurrentTestGlob']) {
      const refused = await scan({
        root: project({ 'package.json': MANIFEST, 'bunfig.toml': `[test]\n${key} = 3\n`, ...layout }),
        framework: 'bun',
      });
      expect(refused.diagnostics.map((item) => item.message)).toEqual([
        'The Bun version could not be read from the project, so the rules of the newest supported version apply.',
        `The config's test.${key} is not a string or a list of strings, so Bun refuses the config and runs no test.`,
        'No test files were found from the configs in the root.',
      ]);
    }
  });

  it('finds Bun from a script that runs bun test or a bunfig.toml, and its version from the pin', async () => {
    const pinned = await scan({ root: project({ 'package.json': MANIFEST, '.bun-version': '1.3.14\n', ...layout }) });
    expect([pinned.framework, pinned.frameworkVersion]).toEqual(['bun', '1.3.14']);
    const manager = JSON.stringify({ name: 'quote-gateway', packageManager: 'bun@1.4.4' });
    const fromConfig = await scan({ root: project({ 'package.json': manager, 'bunfig.toml': '[test]\n', ...layout }) });
    expect([fromConfig.framework, fromConfig.frameworkVersion]).toEqual(['bun', '1.4.4']);
    const engines = JSON.stringify({ name: 'quote-gateway', scripts: { test: 'bun test' }, engines: { bun: '>=1.3' } });
    const ranged = await scan({ root: project({ 'package.json': engines, ...layout }) });
    expect([ranged.frameworkVersion, ranged.diagnostics.map((item) => item.code)]).toEqual([
      '1.3.0',
      ['approximate-framework-version'],
    ]);
    const types = JSON.stringify({
      name: 'quote-gateway',
      scripts: { test: 'bun test' },
      devDependencies: { '@types/bun': '1.2.23' },
    });
    expect((await scan({ root: project({ 'package.json': types, ...layout }) })).frameworkVersion).toBe('1.2.23');
    const old = await scan({ root: project({ 'package.json': MANIFEST, '.bun-version': '1.2.22', ...layout }) });
    expect(old.diagnostics.map((item) => item.message)).toEqual([
      'Bun 1.2.22 is older than 1.2.23, the oldest supported version; the results follow 1.2.23.',
    ]);
    const none = await scan({ root: project({ 'package.json': MANIFEST, ...layout }) });
    expect(none.frameworkVersion).toBeNull();
  });
});
