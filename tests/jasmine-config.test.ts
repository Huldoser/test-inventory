import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { project } from './project.ts';

const JASMINE_PACKAGE = JSON.stringify({ name: 'risk-service', devDependencies: { jasmine: '7.0.0' } });
const SPEC = "describe('exposure', () => {\n  it('sums the open positions', () => {});\n});\n";

function files(inventory: Inventory): string[] {
  return inventory.files.map((file) => file.relativeFilePath);
}

describe('Jasmine config files', () => {
  it('runs the spec_files globs from spec_dir, less those starting with !', async () => {
    const root = project({
      'package.json': JASMINE_PACKAGE,
      'spec/support/jasmine.json': JSON.stringify({
        spec_dir: 'spec',
        spec_files: ['**/*[sS]pec.?(m)js', '!legacy/**'],
        helpers: ['helpers/**/*.?(m)js'],
      }),
      'spec/exposure.spec.js': SPEC,
      'spec/limits/var.Spec.mjs': SPEC,
      'spec/legacy/greeks.spec.js': SPEC,
      'spec/helpers/matchers.js': SPEC,
      'spec/stress.test.js': SPEC,
      'src/limits.spec.js': SPEC,
    });
    const inventory = await scan({ root, framework: 'jasmine' });
    expect(files(inventory)).toEqual(['spec/exposure.spec.js', 'spec/limits/var.Spec.mjs']);
    expect(inventory.configs).toEqual([
      {
        relativeFilePath: 'spec/support/jasmine.json',
        extends: [],
        projects: [{ name: '', testDir: 'spec', dependencies: [] }],
      },
    ]);
  });

  it('reads jasmine.mjs from Jasmine 5, before the json, and jasmine.js after it', async () => {
    const root = project({
      'spec/support/jasmine.mjs': "export default { spec_dir: 'spec', spec_files: ['unit/**/*.spec.js'] };\n",
      'spec/support/jasmine.json': JSON.stringify({ spec_dir: 'spec', spec_files: ['integration/**/*.spec.js'] }),
      'spec/support/jasmine.js': "module.exports = { spec_dir: 'spec', spec_files: ['e2e/**/*.spec.js'] };\n",
      'spec/unit/exposure.spec.js': SPEC,
      'spec/integration/feed.spec.js': SPEC,
      'spec/e2e/report.spec.js': SPEC,
    });
    const jasmine7 = await scan({ root, framework: 'jasmine', frameworkVersion: '7.0.0' });
    expect(files(jasmine7)).toEqual(['spec/unit/exposure.spec.js']);
    const jasmine4 = await scan({ root, framework: 'jasmine', frameworkVersion: '4.6.0' });
    expect(files(jasmine4)).toEqual(['spec/integration/feed.spec.js']);
  });

  it('runs no file without a config, and every file the globs match, as Karma and Angular give Jasmine theirs', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { 'jasmine-core': '5.13.0', karma: '6.4.4' } }),
      'src/app/blotter.component.spec.ts': SPEC,
      'src/app/ticket.component.spec.ts': SPEC,
    });
    const found = await scan({ root, framework: 'jasmine' });
    expect(files(found)).toEqual([]);
    expect(found.diagnostics.map((item) => item.code)).toEqual(['no-files-matched']);
    const given = await scan({ root, framework: 'jasmine', patterns: ['src/**/*.spec.ts'] });
    expect(files(given)).toEqual(['src/app/blotter.component.spec.ts', 'src/app/ticket.component.spec.ts']);
    expect(given.frameworkVersion).toBe('5.13.0');
  });

  it("takes the files it is given as run, as they replace spec_files, and can't tell when spec_files is unknown", async () => {
    const given = await scan({
      root: project({
        'package.json': JASMINE_PACKAGE,
        'spec/support/jasmine.json': JSON.stringify({ spec_dir: 'spec', spec_files: ['*.spec.js', '!draft-*.js'] }),
        'spec/exposure.spec.js': SPEC,
        'spec/nested/limits.spec.js': SPEC,
        'spec/draft-greeks.js': SPEC,
      }),
      framework: 'jasmine',
      patterns: ['spec/**/*.js'],
    });
    expect(given.files.map((file) => [file.relativeFilePath, file.config])).toEqual([
      ['spec/draft-greeks.js', 'spec/support/jasmine.json'],
      ['spec/exposure.spec.js', 'spec/support/jasmine.json'],
      ['spec/nested/limits.spec.js', 'spec/support/jasmine.json'],
    ]);
    expect(given.diagnostics).toEqual([]);
    const unknown = await scan({
      root: project({
        'package.json': JASMINE_PACKAGE,
        'spec/support/jasmine.js': 'module.exports = { spec_dir: process.env.SPEC_DIR, spec_files: ["*.js"] };\n',
        'spec/exposure.spec.js': SPEC,
      }),
      framework: 'jasmine',
    });
    expect(unknown.diagnostics.map((item) => item.code)).toEqual(['config-value-unknown', 'no-files-matched']);
    const unknownFiles = await scan({
      root: project({
        'package.json': JASMINE_PACKAGE,
        'spec/support/jasmine.js': 'module.exports = { spec_dir: "spec", spec_files: process.env.SPECS };\n',
        'spec/exposure.spec.js': SPEC,
      }),
      framework: 'jasmine',
      patterns: ['spec/*.js'],
    });
    expect(files(unknownFiles)).toEqual(['spec/exposure.spec.js']);
  });

  it('follows a spec function and a helper that declares specs, imported from a helpers file', async () => {
    const inventory = await scan({
      root: project({
        'package.json': JASMINE_PACKAGE,
        'spec/helpers/specs.js': [
          'export const slowSpec = xit;',
          'export function limitSpecs(desk) {',
          '  describe(`${desk} limits`, () => {',
          "    it('stays within the limit', () => {});",
          '  });',
          '}',
          '',
        ].join('\n'),
        'spec/limits.spec.js': [
          "import { slowSpec, limitSpecs } from './helpers/specs';",
          "slowSpec('replays a year of fills', () => {});",
          "limitSpecs('rates');",
          '',
        ].join('\n'),
      }),
      framework: 'jasmine',
      patterns: ['spec/limits.spec.js'],
    });
    expect(inventory.tests.map((test) => [test.fullName, test.state])).toEqual([
      ['replays a year of fills', 'skip'],
      ['rates limits > stays within the limit', 'active'],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('runs no file from a config without spec_files, and reads spec_files from the root without spec_dir', async () => {
    const empty = await scan({
      root: project({ 'package.json': JASMINE_PACKAGE, 'spec/support/jasmine.json': '{}', 'spec/a.spec.js': SPEC }),
      framework: 'jasmine',
    });
    expect(files(empty)).toEqual([]);
    const rootGlobs = await scan({
      root: project({
        'package.json': JASMINE_PACKAGE,
        'spec/support/jasmine.json': JSON.stringify({ spec_dir: 42, spec_files: ['test/**/*.js'] }),
        'test/exposure.js': SPEC,
      }),
      framework: 'jasmine',
    });
    expect(files(rootGlobs)).toEqual(['test/exposure.js']);
  });

  it('finds Jasmine from the jasmine command, Karma or its config, and not from jasmine-core alone', async () => {
    const fromCli = await scan({ root: project({ 'package.json': JASMINE_PACKAGE, 'spec/a.spec.js': SPEC }) });
    expect(fromCli.framework).toBe('jasmine');
    const fromKarma = await scan({
      root: project({
        'package.json': JSON.stringify({ devDependencies: { 'jasmine-core': '4.6.1', 'karma-jasmine': '5.1.0' } }),
      }),
    });
    expect(fromKarma.framework).toBe('jasmine');
    const movedToJest = await scan({
      root: project({
        'package.json': JSON.stringify({
          devDependencies: { jest: '30.5.2', 'jasmine-core': '5.13.0', '@types/jasmine': '5.1.9' },
        }),
      }),
    });
    expect(movedToJest.framework).toBe('jest');
    const fromConfig = await scan({ root: project({ 'spec/support/jasmine.json': '{}' }) });
    expect(fromConfig.framework).toBe('jasmine');
  });
});
