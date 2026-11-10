import { symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { project } from './project.ts';

const JEST_PACKAGE = JSON.stringify({ name: 'settlement-service', devDependencies: { jest: '30.5.2' } });
const TEST = "test('books the cash leg', () => {});\n";

function files(inventory: Inventory): string[] {
  return inventory.files.map((file) => file.relativeFilePath);
}

function messages(inventory: Inventory): string[] {
  return inventory.diagnostics.map((item) => `${item.code}: ${item.message}`);
}

describe('Jest without a config file', () => {
  it("runs the files Jest's default testMatch picks from the package.json folder", async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'src/__tests__/fees.js': TEST,
      'src/routing.test.ts': TEST,
      'src/ledger.spec.tsx': TEST,
      'src/ledger.ts': 'export const ledger = [];\n',
      'e2e/orders.test.mjs': TEST,
      'node_modules/broker-sdk/client.test.js': TEST,
    });
    const jest30 = await scan({ root, framework: 'jest' });
    expect(files(jest30)).toEqual([
      'e2e/orders.test.mjs',
      'src/__tests__/fees.js',
      'src/ledger.spec.tsx',
      'src/routing.test.ts',
    ]);
    expect(jest30.configs).toEqual([
      { relativeFilePath: 'package.json', extends: [], projects: [{ name: '', testDir: '.', dependencies: [] }] },
    ]);
    const jest29 = await scan({ root, framework: 'jest', frameworkVersion: '29.7.0' });
    expect(files(jest29)).toEqual(['src/__tests__/fees.js', 'src/ledger.spec.tsx', 'src/routing.test.ts']);
  });

  it('takes the defaults from the root when no package.json is found up to it', async () => {
    const root = project({ 'src/routing.test.ts': TEST, 'src/routing.ts': 'export {};\n' });
    const inventory = await scan({ root, framework: 'jest' });
    expect(files(inventory)).toEqual(['src/routing.test.ts']);
    expect(inventory.configs).toEqual([]);
    expect(inventory.files[0].config).toBeNull();
  });

  it('leaves out test files reached through a symbolic link, which Jest does not follow', async () => {
    const root = project({ 'package.json': JEST_PACKAGE, 'shared/fees.test.ts': TEST });
    symlinkSync(path.join(root, 'shared'), path.join(root, 'linked'), 'junction');
    const inventory = await scan({ root, framework: 'jest', patterns: ['**/*.test.ts'] });
    expect(files(inventory)).toEqual(['shared/fees.test.ts']);
    expect(messages(inventory)).toEqual([
      'symlink-ignored: The file is reached through a symbolic link, which Jest does not follow.',
    ]);
  });
});

describe('Jest config files', () => {
  it('reads the test file settings, with <rootDir>', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': `module.exports = {
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.check.[jt]s', '!**/*.slow.check.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/fixtures/'],
  modulePathIgnorePatterns: ['<rootDir>/src/generated'],
  moduleFileExtensions: ['js', 'ts'],
};
`,
      'src/fees.check.ts': TEST,
      'src/fees.slow.check.ts': TEST,
      'src/fees.check.tsx': TEST,
      'src/generated/rates.check.ts': TEST,
      'tests/ledger.check.js': TEST,
      'tests/fixtures/sample.check.js': TEST,
      'scripts/release.check.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(files(inventory)).toEqual(['src/fees.check.ts', 'tests/ledger.check.js']);
    expect(inventory.configs.map((config) => config.relativeFilePath)).toEqual(['jest.config.js']);
  });

  it('keeps every file but those a testMatch of negated globs only leaves out', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testMatch: ['!**/*.helper.js'] };\n",
      'src/fees.js': TEST,
      'src/fees.helper.js': TEST,
    });
    expect(files(await scan({ root, framework: 'jest' }))).toEqual(['jest.config.js', 'src/fees.js']);
  });

  it('reads testRegex in place of the default testMatch, from the absolute path', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testRegex: ['/specs/.*\\\\.js$', /\\.unit\\.ts$/] };\n",
      'specs/fees.js': TEST,
      'src/routing.unit.ts': TEST,
      'src/routing.test.ts': TEST,
    });
    expect(files(await scan({ root, framework: 'jest' }))).toEqual(['specs/fees.js', 'src/routing.unit.ts']);
  });

  it('reports a config with both testMatch and testRegex, which Jest refuses', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testMatch: ['**/*.test.js'], testRegex: 'spec' };\n",
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest', patterns: ['src/*.js'] });
    expect(messages(inventory)).toEqual([
      'config-value-unknown: The config sets both testMatch and testRegex, which Jest refuses, so it runs no tests.',
      "file-not-run: The file has tests, but no config in its folder or above runs it, so the runner doesn't collect them; the nearest config is jest.config.js.",
    ]);
  });

  it('reads an ES module, a TypeScript config and a config function, which Jest calls and awaits', async () => {
    const configs = {
      'jest.config.mjs': "export default { testMatch: ['**/*.check.js'] };\n",
      'jest.config.ts':
        "import type { Config } from 'jest';\nconst config: Config = { testMatch: ['**/*.check.js'] };\nexport default config;\n",
      'jest.config.js': "module.exports = async () => {\n  return { testMatch: ['**/*.check.js'] };\n};\n",
      'jest.config.cjs': "const config = () => ({ testMatch: ['**/*.check.js'] });\nmodule.exports = config;\n",
      'jest.config.json': '{ "testMatch": ["**/*.check.js"] }\n',
    };
    for (const [name, code] of Object.entries(configs)) {
      const root = project({
        'package.json': JEST_PACKAGE,
        [name]: code,
        'src/fees.check.js': TEST,
        'src/fees.test.js': TEST,
      });
      expect(files(await scan({ root, framework: 'jest' }))).toEqual(['src/fees.check.js']);
    }
    const shared = project({
      'package.json': JEST_PACKAGE,
      'jest.base.js': "module.exports = { testMatch: ['**/*.check.js'] };\n",
      'jest.config.js': "import base from './jest.base.js';\nexport default base;\n",
      'src/fees.check.js': TEST,
    });
    expect(files(await scan({ root: shared, framework: 'jest' }))).toEqual(['src/fees.check.js']);
    const declared = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "export default function config() { return { testMatch: ['**/*.check.js'] }; }\n",
      'src/fees.check.js': TEST,
    });
    expect(files(await scan({ root: declared, framework: 'jest' }))).toEqual(['src/fees.check.js']);
  });

  it('reads .cts configs from Jest 30.0 and .mts configs from 30.4', async () => {
    const root = project({
      'jest.config.mts': "export default { testMatch: ['**/*.mts-config.js'] };\n",
      'jest.config.cts': "module.exports = { testMatch: ['**/*.cts-config.js'] };\n",
      'package.json': JSON.stringify({ jest: { testMatch: ['**/*.package.js'] } }),
      'src/a.mts-config.js': TEST,
      'src/b.cts-config.js': TEST,
      'src/c.package.js': TEST,
    });
    const picked = async (version: string) => files(await scan({ root, framework: 'jest', frameworkVersion: version }));
    expect(await picked('29.7.0')).toEqual(['src/c.package.js']);
    expect(await picked('30.0.0')).toEqual(['src/b.cts-config.js']);
    expect(await picked('30.4.0')).toEqual(['src/a.mts-config.js']);
  });

  it("reads the package.json jest key, and from Jest 30 a string there as the config's path", async () => {
    const root = project({
      'package.json': JSON.stringify({ jest: 'config/jest.json' }),
      'config/jest.json': '{ "rootDir": "..", "testMatch": ["**/*.check.js"] }\n',
      'src/fees.check.js': TEST,
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(files(inventory)).toEqual(['src/fees.check.js']);
    expect(inventory.configs.map((config) => config.relativeFilePath)).toEqual(['config/jest.json']);
    const jest29 = await scan({ root, framework: 'jest', frameworkVersion: '29.7.0' });
    expect(jest29.configs.map((config) => config.relativeFilePath)).toEqual(['package.json']);
  });

  it('reports a testRegex that is not a regular expression, with which Jest fails to start', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testRegex: ['spec', '(unclosed'] };\n",
      'src/fees.spec.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest', patterns: ['src/*.js'] });
    expect(messages(inventory)[0]).toBe(
      "config-value-unknown: The config's testRegex '(unclosed' is not a regular expression, so Jest fails to start.",
    );
  });

  it('reads a package.json that does not parse as no config', async () => {
    const root = project({ 'package.json': '{ "name": ', 'src/fees.test.js': TEST });
    const inventory = await scan({ root, framework: 'jest', patterns: ['src/*.js'] });
    expect(inventory.diagnostics.map((item) => item.code)).toEqual([
      'unknown-framework-version',
      'config-value-unknown',
    ]);
  });

  it('reports a JSON config that does not parse', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.json': '{ testMatch: [] }\n',
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest', patterns: ['src/*.js'] });
    expect(inventory.diagnostics[0].message).toMatch(
      /^The config could not be parsed: .*, so the scan reads none of its settings\.$/,
    );
  });

  it('reports settings it cannot work out, and a defineConfig() Jest does not have', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': `const { defineConfig } = require('some-helpers');
module.exports = { rootDir: process.env.ROOT, testMatch: defineConfig(['**/*.check.js']) };
`,
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest', patterns: ['src/*.js'] });
    expect(messages(inventory)).toEqual([
      "config-value-unknown: The config's rootDir could not be worked out without running the config, so the scan takes its files to be run.",
    ]);
    const matching = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testMatch: helpers.match, roots: [process.env.ROOT], testRegex: ['('] };\n",
      'src/fees.test.js': TEST,
    });
    const unknown = await scan({ root: matching, framework: 'jest' });
    expect(unknown.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown', 'no-files-matched']);
  });

  it('keeps the files the other settings pick when an ignore list cannot be worked out', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testPathIgnorePatterns: ignored.map((file) => '<rootDir>/' + file) };\n",
      'src/fees.test.js': TEST,
      'src/fees.js': 'module.exports = {};\n',
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(files(inventory)).toEqual(['src/fees.test.js']);
    expect(messages(inventory)).toEqual([
      "config-value-unknown: The config's testPathIgnorePatterns could not be worked out without running the config, so the scan may list test files that Jest leaves out.",
    ]);
  });

  it('warns about a preset it does not read, unless the config sets the test files or the preset leaves them', async () => {
    const run = async (config: object) => {
      const root = project({
        'package.json': JEST_PACKAGE,
        'jest.config.json': JSON.stringify(config),
        'src/fees.test.js': TEST,
      });
      return messages(await scan({ root, framework: 'jest' }));
    };
    expect(await run({ preset: 'jest-expo' })).toEqual([
      "config-value-unknown: The config's preset 'jest-expo' is a package the scan doesn't read, and it may set which files are tests; the scan takes Jest's defaults for what the config doesn't set.",
    ]);
    expect(await run({ preset: 'jest-expo', testMatch: ['**/*.test.js'] })).toEqual([]);
    expect(await run({ preset: 'ts-jest/presets/default-esm' })).toEqual([]);
    expect(await run({ preset: 'jest-puppeteer' })).toEqual([]);
  });
});

describe('Jest config lookup', () => {
  it('takes a nested package.json as a config only with a jest key, as Jest started at the root reads the root one', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testPathIgnorePatterns: ['/node_modules/', '/fixtures/'] };\n",
      'fixtures/broker/package.json': JSON.stringify({ name: 'broker-fixture' }),
      'fixtures/broker/order.test.js': TEST,
      'packages/ledger/package.json': JSON.stringify({ name: 'ledger', jest: { displayName: 'ledger' } }),
      'packages/ledger/post.test.js': TEST,
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest', patterns: ['**/*.test.js'] });
    expect(inventory.files.map((file) => [file.relativeFilePath, file.config])).toEqual([
      ['fixtures/broker/order.test.js', 'jest.config.js'],
      ['packages/ledger/post.test.js', 'jest.config.js'],
      ['src/fees.test.js', 'jest.config.js'],
    ]);
    expect(messages(inventory)).toEqual([
      "file-not-run: The file has tests, but no config in its folder or above runs it, so the runner doesn't collect them; the nearest config is jest.config.js.",
    ]);
  });

  it("reads Jest 30.3's defineConfig() and mergeConfig()", async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.base.js': "module.exports = { testMatch: ['**/*.check.js'] };\n",
      'jest.config.js': `const { defineConfig, mergeConfig } = require('jest');
const base = require('./jest.base.js');
module.exports = defineConfig(mergeConfig(base, { testMatch: ['**/*.verify.js'] }));
`,
      'src/fees.check.js': TEST,
      'src/fees.verify.js': TEST,
      'src/fees.test.js': TEST,
    });
    expect(files(await scan({ root, framework: 'jest' }))).toEqual(['src/fees.check.js', 'src/fees.verify.js']);
    const spreads = [
      "const base = require('./jest.base.js');\nmodule.exports = { ...base, testMatch: ['**/*.check.js'] };\n",
      "module.exports = { ...require('./jest.base.js'), testMatch: ['**/*.check.js'] };\n",
    ];
    for (const config of spreads) {
      const empty = project({
        'package.json': JEST_PACKAGE,
        'jest.base.js': "globalThis.base = { testMatch: ['**/*.check.js'] };\n",
        'jest.config.js': config,
        'src/fees.check.js': TEST,
      });
      const spread = await scan({ root: empty, framework: 'jest' });
      expect(spread.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown', 'no-files-matched']);
    }
    const old = await scan({ root, framework: 'jest', frameworkVersion: '30.2.0', patterns: ['src/*.js'] });
    expect(old.diagnostics.map((item) => item.code)).toContain('config-value-unknown');
    const fn = project({
      'package.json': JEST_PACKAGE,
      'jest.config.ts':
        "import { defineConfig } from 'jest-config';\nexport default defineConfig(() => ({ testMatch: ['**/*.check.js'] }));\n",
      'src/fees.check.js': TEST,
      'src/fees.test.js': TEST,
    });
    expect(files(await scan({ root: fn, framework: 'jest' }))).toEqual(['src/fees.check.js']);
  });

  it('reports two configs in one folder, with which Jest refuses to start', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { jest: '30.5.2' }, jest: { testMatch: ['**/*.check.js'] } }),
      'jest.config.js': 'module.exports = {};\n',
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest', patterns: ['src/*.js'] });
    expect(messages(inventory)).toEqual([
      'config-value-unknown: Jest finds more than one config in this folder, jest.config.js and the jest key in package.json, and refuses to start; the scan reads jest.config.js.',
    ]);
  });

  it('reports an ignore pattern that is not a regular expression, with which Jest fails to start', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testPathIgnorePatterns: ['/node_modules/', '(unclosed'] };\n",
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest', patterns: ['src/*.js'] });
    expect(messages(inventory)[0]).toBe(
      "config-value-unknown: The config's testPathIgnorePatterns is not a regular expression, so Jest fails to start.",
    );
  });

  it('reads ignore patterns that escape with a backslash, on every system', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testPathIgnorePatterns: ['\\\\.e2e\\\\.'] };\n",
      'src/fees.test.js': TEST,
      'src/orders.e2e.test.js': TEST,
    });
    expect(files(await scan({ root, framework: 'jest' }))).toEqual(['src/fees.test.js']);
  });
});

describe('Jest projects', () => {
  it('runs the projects the config lists: folders, config files and objects, named by displayName', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': `module.exports = {
  projects: [
    '<rootDir>/packages/*',
    'tools/lint-rules/jest.config.json',
    { displayName: 'scripts', testMatch: ['<rootDir>/scripts/**/*.test.js'] },
    { displayName: { name: 'e2e', color: 'blue' }, rootDir: 'e2e' },
  ],
};
`,
      'packages/ledger/package.json': JSON.stringify({ name: 'ledger', jest: { displayName: 'ledger' } }),
      'packages/ledger/src/post.test.js': TEST,
      'packages/fees/jest.config.js': "module.exports = { displayName: 'fees', roots: ['<rootDir>/src'] };\n",
      'packages/fees/src/minimum.test.js': TEST,
      'packages/fees/scripts/check.test.js': TEST,
      'tools/lint-rules/jest.config.json': '{ "displayName": "lint-rules" }\n',
      'tools/lint-rules/no-floats.test.js': TEST,
      'scripts/release.test.js': TEST,
      'e2e/orders.test.js': TEST,
      'src/root.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.projects])).toEqual([
      ['e2e/orders.test.js', ['e2e']],
      ['packages/fees/src/minimum.test.js', ['fees']],
      ['packages/ledger/src/post.test.js', ['ledger']],
      ['scripts/release.test.js', ['scripts']],
      ['tools/lint-rules/no-floats.test.js', ['lint-rules']],
    ]);
    expect(inventory.configs.find((config) => config.relativeFilePath === 'jest.config.js')?.projects).toEqual([
      { name: 'fees', testDir: 'packages/fees', dependencies: [] },
      { name: 'ledger', testDir: 'packages/ledger', dependencies: [] },
      { name: 'lint-rules', testDir: 'tools/lint-rules', dependencies: [] },
      { name: 'scripts', testDir: '.', dependencies: [] },
      { name: 'e2e', testDir: 'e2e', dependencies: [] },
    ]);
  });

  it('reports a preset once, however many entries name its project', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { projects: ['packages/*', 'packages/fees'] };\n",
      'packages/fees/jest.config.json': '{ "preset": "jest-expo" }\n',
      'packages/fees/src/minimum.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.diagnostics.map((item) => item.relativeFilePath)).toEqual(['packages/fees/jest.config.json']);
  });

  it('leaves out files a projects glob matches that Jest cannot require, such as a README', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { projects: ['<rootDir>/packages/*'] };\n",
      'packages/README.md': '# Packages\n',
      'packages/LICENSE': 'MIT\n',
      'packages/fees/jest.config.js': "module.exports = { displayName: 'fees' };\n",
      'packages/fees/minimum.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.tests.map((test) => test.projects)).toEqual([['fees']]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it("runs the config's own files when an entry names its folder", async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { displayName: 'api', projects: ['<rootDir>', 'missing'] };\n",
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.tests.map((test) => test.projects)).toEqual([['api']]);
  });

  it('reports projects it cannot work out', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': 'module.exports = { projects: [getProjects()], rootDir: "." };\n',
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest', patterns: ['src/*.js'] });
    expect(inventory.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown']);
    const unknownRoot = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': 'module.exports = { projects: ["packages/*"], rootDir: process.env.ROOT };\n',
      'src/fees.test.js': TEST,
    });
    const notRead = await scan({ root: unknownRoot, framework: 'jest', patterns: ['src/*.js'] });
    expect(notRead.diagnostics[0].message).toMatch(/^The config's rootDir could not be worked out/);
    const notList = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': 'module.exports = { projects: process.env.PROJECTS };\n',
      'src/fees.test.js': TEST,
    });
    const notListed = await scan({ root: notList, framework: 'jest', patterns: ['src/*.js'] });
    expect(notListed.diagnostics[0].message).toMatch(/^The config's projects could not be worked out/);
  });

  it("gives tests the root config's testTimeout, and from Jest 30 a project's own", async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': `module.exports = {
  testTimeout: 10000,
  projects: [{ displayName: 'unit' }, { displayName: 'slow', testMatch: ['**/*.slow.js'], testTimeout: 60000 }],
};
`,
      'src/fees.test.js': TEST,
      'src/replay.slow.js': TEST,
    });
    const timeouts = async (version: string) =>
      (await scan({ root, framework: 'jest', frameworkVersion: version })).tests.map((test) => [
        test.relativeFilePath,
        test.timeout,
        test.timeoutSource,
      ]);
    expect(await timeouts('30.0.0')).toEqual([
      ['src/fees.test.js', 10000, 'config'],
      ['src/replay.slow.js', 60000, 'config'],
    ]);
    expect(await timeouts('29.7.0')).toEqual([
      ['src/fees.test.js', 10000, 'config'],
      ['src/replay.slow.js', 10000, 'config'],
    ]);
  });
});

describe('Jest globals and setup files', () => {
  it('warns when a file uses the globals and its config turns them off', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': 'module.exports = { injectGlobals: false };\n',
      'src/fees.test.js': TEST,
      'src/routing.test.js': "import { test } from '@jest/globals';\n" + TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(messages(inventory)).toEqual([
      "globals-not-enabled: The file uses describe, it or test without importing them, but jest.config.js sets injectGlobals to false, so Jest doesn't define them; import them from '@jest/globals'.",
    ]);
    expect(inventory.diagnostics[0].relativeFilePath).toBe('src/fees.test.js');
  });

  it('points at a setup file a JSON config names that does not exist', async () => {
    const root = project({
      'package.json': `{
  "devDependencies": { "jest": "30.5.2" },
  "jest": {
    "setupFiles": ["<rootDir>/test/missing.js", "\\u002e/test/gone.js"]
  }
}
`,
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.tests[0].hasUnfollowedDependencies).toBe(true);
    expect(inventory.diagnostics.map((item) => [item.lineStart, item.message])).toEqual([
      [1, "setupFiles names './test/gone.js', which could not be read, so dependencyHash doesn't cover it."],
      [4, "setupFiles names '<rootDir>/test/missing.js', which could not be read, so dependencyHash doesn't cover it."],
    ]);
  });

  it('counts setup files, with <rootDir>, in dependencyHash', async () => {
    const config = (setup: string) => `module.exports = { setupFilesAfterEnv: ['${setup}'] };\n`;
    const scanWith = async (setup: string) => {
      const root = project({
        'package.json': JEST_PACKAGE,
        'jest.config.js': config('<rootDir>/test/setup.js'),
        'test/setup.js': setup,
        'src/fees.test.js': TEST,
      });
      return (await scan({ root, framework: 'jest' })).tests[0];
    };
    const [before, after] = [await scanWith('globalThis.fx = 1;\n'), await scanWith('globalThis.fx = 2;\n')];
    expect(before.dependencies).toContain('test/setup.js');
    expect(before.dependencyHash).not.toBe(after.dependencyHash);
  });
});

describe('Jest configs checked against jest --listTests 29.7 and 30.5', () => {
  it('runs each projects folder with its own package.json, also without a jest key', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { projects: ['<rootDir>/packages/*'] };\n",
      'packages/ledger/package.json': JSON.stringify({ name: 'ledger' }),
      'packages/ledger/post.test.js': TEST,
      'packages/fees/package.json': JSON.stringify({ name: 'fees' }),
      'packages/fees/src/minimum.test.js': TEST,
      'tools/release.test.js': TEST,
      'settle.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(files(inventory)).toEqual(['packages/fees/src/minimum.test.js', 'packages/ledger/post.test.js']);
    expect(inventory.configs.map((config) => [config.relativeFilePath, config.projects])).toEqual([
      ['packages/fees/package.json', [{ name: '', testDir: 'packages/fees', dependencies: [] }]],
      ['packages/ledger/package.json', [{ name: '', testDir: 'packages/ledger', dependencies: [] }]],
    ]);
  });

  it("reads <rootDir> in an inline project's rootDir as the config's folder", async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { projects: [{ rootDir: '<rootDir>/packages/fees' }] };\n",
      'packages/fees/minimum.test.js': TEST,
      'settle.test.js': TEST,
    });
    expect(files(await scan({ root, framework: 'jest' }))).toEqual(['packages/fees/minimum.test.js']);
  });

  it('runs the config itself when projects is empty', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': 'module.exports = { projects: [] };\n',
      'src/fees.test.js': TEST,
    });
    expect(files(await scan({ root, framework: 'jest' }))).toEqual(['src/fees.test.js']);
  });

  it('reads only the config Jest starts with in the root, and those its projects name', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testPathIgnorePatterns: ['/node_modules/', '/sub/'] };\n",
      'sub/jest.config.js': 'module.exports = {};\n',
      'sub/legacy.test.js': TEST,
      'settle.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(files(inventory)).toEqual(['settle.test.js']);
    const withPatterns = await scan({ root, framework: 'jest', patterns: ['**/*.test.js'] });
    expect(withPatterns.files.map((file) => [file.relativeFilePath, file.config])).toEqual([
      ['settle.test.js', 'jest.config.js'],
      ['sub/legacy.test.js', 'jest.config.js'],
    ]);
    expect(withPatterns.diagnostics.map((item) => item.code)).toEqual(['file-not-run']);
  });

  it('replaces <rootDir> anywhere in an ignore pattern, as Jest does', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js':
        "module.exports = { testPathIgnorePatterns: ['/node_modules/', 'nothing|<rootDir>/legacy'] };\n",
      'legacy/fees.test.js': TEST,
      'src/fees.test.js': TEST,
    });
    expect(files(await scan({ root, framework: 'jest' }))).toEqual(['src/fees.test.js']);
  });

  it('reads a JSON base config, required, spread or imported', async () => {
    const configs = {
      'jest.config.js': "module.exports = require('./jest.base.json');\n",
      'jest.config.cjs': "module.exports = { ...require('./jest.base.json'), displayName: 'unit' };\n",
      'jest.config.mjs': "import base from './jest.base.json' with { type: 'json' };\nexport default base;\n",
    };
    for (const [name, code] of Object.entries(configs)) {
      const root = project({
        'package.json': JEST_PACKAGE,
        'jest.base.json': '{ "testMatch": ["**/*.check.js"] }\n',
        [name]: code,
        'src/fees.check.js': TEST,
        'src/fees.test.js': TEST,
      });
      expect(files(await scan({ root, framework: 'jest' }))).toEqual(['src/fees.check.js']);
    }
  });

  it('reads a named key of a JSON file, and reports one that is missing or not JSON', async () => {
    const named = project({
      'package.json': JEST_PACKAGE,
      'jest.base.json': '{ "testMatch": ["**/*.check.js"] }\n',
      'jest.config.mjs':
        "import { testMatch } from './jest.base.json' with { type: 'json' };\nexport default { testMatch };\n",
      'src/fees.check.js': TEST,
      'src/fees.test.js': TEST,
    });
    expect(files(await scan({ root: named, framework: 'jest' }))).toEqual(['src/fees.check.js']);
    const bases: Record<string, string>[] = [{}, { 'jest.base.json': '{ testMatch: [] }' }];
    for (const base of bases) {
      const root = project({
        'package.json': JEST_PACKAGE,
        ...base,
        'jest.config.js': "module.exports = { ...require('./jest.base.json') };\n",
        'src/fees.test.js': TEST,
      });
      const inventory = await scan({ root, framework: 'jest', patterns: ['src/*.js'] });
      expect(inventory.diagnostics.map((item) => item.code)).toContain('config-value-unknown');
    }
  });

  it('reads two keys of the same JSON file', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.base.json': '{ "testMatch": ["**/*.check.js"], "testTimeout": 20000 }\n',
      'jest.config.js':
        "module.exports = { testMatch: require('./jest.base.json').testMatch, testTimeout: require('./jest.base.json').testTimeout };\n",
      'src/fees.check.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.timeout])).toEqual([
      ['src/fees.check.js', 20000],
    ]);
    expect(inventory.configs[0].extends).toEqual(['jest.base.json']);
  });

  it('does not claim Jest runs files when a local preset is missing', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { preset: './missing-preset.js' };",
      'src/fees.test.js': TEST,
    });
    const discovered = await scan({ root, framework: 'jest' });
    expect(files(discovered)).toEqual([]);
    expect(discovered.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown', 'no-files-matched']);
    const explicit = await scan({ root, framework: 'jest', patterns: ['src/*.test.js'] });
    expect(explicit.tests[0].projects).toEqual([]);
    expect(explicit.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown', 'file-not-run']);
  });

  it('reports a local preset that is missing, and keeps the config when the preset is not an object', async () => {
    const missing = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { preset: './jest.preset.js' };\n",
      'src/fees.test.js': TEST,
    });
    expect(messages(await scan({ root: missing, framework: 'jest' }))).toEqual([
      "config-value-unknown: The config's preset './jest.preset.js' doesn't exist, so Jest fails to start.",
      'no-files-matched: No test files were found from the configs in the root.',
    ]);
    const computed = project({
      'package.json': JEST_PACKAGE,
      'jest.preset.js': 'module.exports = makePreset();\n',
      'jest.config.js': "module.exports = { preset: '<rootDir>/jest.preset.js', testMatch: ['**/*.check.js'] };\n",
      'src/fees.check.js': TEST,
    });
    expect(files(await scan({ root: computed, framework: 'jest' }))).toEqual(['src/fees.check.js']);
  });

  it('finds the config of a projects folder from its parent, and of one outside the root from nothing', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { displayName: 'all', projects: ['<rootDir>/packages/fees', '..'] };\n",
      'packages/fees/src/minimum.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.tests.map((test) => test.projects)).toEqual([['all', 'all']]);
  });

  it('reports two configs in the root once, also when projects name the root', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { jest: '30.5.2' }, jest: {} }),
      'jest.config.js': "module.exports = { projects: ['<rootDir>'] };\n",
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown']);
  });

  it('reads testMatch: null beside testRegex as Jest does, as no testMatch', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js': "module.exports = { testMatch: null, testRegex: '/__tests__/.*\\\\.test\\\\.js$' };\n",
      'src/__tests__/fees.test.js': TEST,
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(files(inventory)).toEqual(['src/__tests__/fees.test.js']);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('keeps the ignore patterns it can work out when one entry is unknown', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.config.js':
        "module.exports = { testPathIgnorePatterns: ['/node_modules/', '/fixtures/', ...(process.env.BUNDLE ? ['/bundled/'] : [])] };\n",
      'fixtures/order.test.js': TEST,
      'bundled/order.test.js': TEST,
      'src/fees.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(files(inventory)).toEqual(['bundled/order.test.js', 'src/fees.test.js']);
    expect(inventory.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown']);
  });

  it('reads a preset that is a local file, under the settings of the config', async () => {
    const root = project({
      'package.json': JEST_PACKAGE,
      'jest.preset.js':
        "module.exports = { testMatch: ['**/*.check.js'], testTimeout: 120000, testPathIgnorePatterns: ['/dist/'] };\n",
      'packages/fees/jest.config.js': "module.exports = { preset: '../../jest.preset.js', displayName: 'fees' };\n",
      'jest.config.js': "module.exports = { projects: ['<rootDir>/packages/*'] };\n",
      'packages/fees/src/minimum.check.js': TEST,
      'packages/fees/dist/minimum.check.js': TEST,
      'packages/fees/src/minimum.test.js': TEST,
    });
    const inventory = await scan({ root, framework: 'jest' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.timeout, test.projects])).toEqual([
      ['packages/fees/src/minimum.check.js', 120000, ['fees']],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });
});
