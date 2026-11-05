import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.ts';
import { scan } from '../src/index.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

const SPEC = "import { test } from '@playwright/test';\ntest('places a market order', async () => {});\n";
const UNIT = "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n";
const JEST = "test('books the cash leg', () => {});\n";

describe('framework detection', () => {
  it.each([
    ['the jest dependency', { 'package.json': JSON.stringify({ devDependencies: { jest: '^30.5.0' } }) }, 'jest'],
    ['a jest key in package.json', { 'package.json': JSON.stringify({ jest: { testTimeout: 10000 } }) }, 'jest'],
    ['a Jest config', { 'jest.config.json': '{}' }, 'jest'],
    ['the vitest dependency', { 'package.json': VITEST_PACKAGE }, 'vitest'],
    ['a Vitest config in a package', { 'packages/fees/vitest.config.mts': 'export default {};\n' }, 'vitest'],
    ['the @playwright/test dependency', { 'package.json': PLAYWRIGHT_PACKAGE }, 'playwright'],
    ['a Playwright config', { 'e2e/playwright.config.ts': 'export default {};\n' }, 'playwright'],
  ])('picks the one runner a project uses, found from %s', async (_, files, framework) => {
    const root = project({ ...files, 'src/fees.test.ts': JEST });
    expect((await scan({ root, patterns: ['src/*.ts'] })).framework).toBe(framework);
  });

  it('reads the package.json of a monorepo above the root', async () => {
    const monorepo = project({
      'package.json': JSON.stringify({ workspaces: ['services/*'], devDependencies: { jest: '30.5.2' } }),
      'services/settlement/src/fees.test.js': JEST,
    });
    const inventory = await scan({ root: path.join(monorepo, 'services/settlement'), patterns: ['src/*.js'] });
    expect(inventory.framework).toBe('jest');
  });

  it("takes the root's own runner over the one a monorepo above it uses", async () => {
    const monorepo = project({
      'package.json': VITEST_PACKAGE,
      'services/settlement/package.json': JSON.stringify({ devDependencies: { jest: '30.5.2' } }),
      'services/settlement/src/fees.test.js': JEST,
    });
    const inventory = await scan({ root: path.join(monorepo, 'services/settlement'), patterns: ['src/*.js'] });
    expect(inventory.framework).toBe('jest');
  });

  it('leaves out installed packages and a Vite config, which Vite apps without Vitest have', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { vite: '7.0.0', jest: '30.5.2' } }),
      'vite.config.ts': 'export default {};\n',
      'node_modules/@playwright/test/package.json': JSON.stringify({ dependencies: { '@playwright/test': '1.64.1' } }),
      'node_modules/broker-sdk/vitest.config.ts': 'export default {};\n',
      'src/fees.test.js': JEST,
    });
    expect((await scan({ root })).framework).toBe('jest');
  });

  it('leaves out what the ignore globs leave out', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { jest: '30.5.2' } }),
      'examples/storefront/vitest.config.ts': 'export default {};\n',
      'src/fees.test.js': JEST,
    });
    expect((await scan({ root, patterns: ['src/*.js'], ignore: ['examples/**'] })).framework).toBe('jest');
  });

  it('throws a TypeError that names the runners when a project uses several', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.64.1', vitest: '5.0.5' } }),
      'jest.config.js': 'module.exports = {};\n',
      'e2e/orders.spec.ts': SPEC,
      'src/fees.test.ts': UNIT,
    });
    await expect(scan({ root })).rejects.toThrow(
      new TypeError(
        'options.framework is needed, as the project uses Playwright, Vitest and Jest: scan it once with each of "playwright", "vitest", "jest".',
      ),
    );
    expect((await scan({ root, framework: 'vitest', patterns: ['src/*.ts'] })).tests).toHaveLength(1);
  });

  it('throws a TypeError when a project uses none of them', async () => {
    const root = project({ 'package.json': JSON.stringify({ devDependencies: { ava: '6.4.1' } }), 'test/a.js': '' });
    await expect(scan({ root })).rejects.toThrow(
      new TypeError(
        'options.framework is needed: no package.json in the root, below it or above it lists @playwright/test, vitest, jest or mocha, and no config of theirs is in the root or below.',
      ),
    );
  });

  it('says on the command line which runners it found, with --framework', async () => {
    const root = project({
      'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.64.1', vitest: '5.0.5' } }),
    });
    const stderr = new PassThrough();
    const chunks: string[] = [];
    stderr.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    const code = await run([], { stdout: new PassThrough(), stderr, cwd: root });
    expect(code).toBe(2);
    expect(chunks.join('')).toBe(
      'test-inventory: --framework is needed, as the project uses Playwright and Vitest: scan it once with each of "playwright", "vitest".\nRun test-inventory --help for usage.\n',
    );
  });
});
