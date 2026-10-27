import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan } from '../src/index.ts';
import { EXAMPLES, fixtures, readGolden } from './examples.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

const SPEC = "import { test } from '@playwright/test';\ntest('places a market order', async () => {});\n";
const UNIT = "import { test } from 'vitest';\ntest('charges the minimum fee', () => {});\n";

describe('a scan without patterns', () => {
  it.each(EXAMPLES)(
    'finds the tests of $name from its configs, as the golden scan with patterns does',
    async ({ name, framework }) => {
      const inventory = await scan({ root: path.join(fixtures, name), framework });
      const golden = readGolden(name);
      expect(inventory.tests).toEqual(golden.tests);
      expect(inventory.suites).toEqual(golden.suites);
      expect(inventory.configs).toEqual(golden.configs);
    },
  );

  it('scans only the files a config runs, in every folder under the root', async () => {
    const root = project({
      'package.json': VITEST_PACKAGE,
      'vitest.config.ts': "export default { test: { include: ['tests/**/*.test.ts'] } };\n",
      'tests/fees.test.ts': UNIT,
      'src/fees.ts': 'export const fee = 1;\n',
      'scripts/replay.test.ts': UNIT,
      'packages/quotes/vitest.config.ts': 'export default {};\n',
      'packages/quotes/src/feed.test.ts': UNIT,
    });
    const inventory = await scan({ root, framework: 'vitest' });
    expect(inventory.files.map((file) => [file.relativeFilePath, file.config])).toEqual([
      ['packages/quotes/src/feed.test.ts', 'packages/quotes/vitest.config.ts'],
      ['tests/fees.test.ts', 'vitest.config.ts'],
    ]);
    expect(inventory.summary.fileCount).toBe(2);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('says to give patterns for a config whose files it cannot work out', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'playwright.config.ts': "import { e2e } from '@trading/e2e-config';\nexport default e2e;\n",
      'tests/orders.spec.ts': SPEC,
    });
    const inventory = await scan({ root, framework: 'playwright' });
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message])).toEqual([
      [
        'config-value-unknown',
        "The config's projects could not be worked out without running the config, so the scan can't tell which files it runs; give patterns to scan them.",
      ],
      ['no-files-matched', 'No test files were found from the configs in the root.'],
    ]);
  });

  it.each([
    ['playwright', 'Playwright', PLAYWRIGHT_PACKAGE, 'tests/orders.spec.ts', SPEC],
    ['vitest', 'Vitest', VITEST_PACKAGE, 'tests/fees.test.ts', UNIT],
  ] as const)(
    'says when there is no %s config to find the tests from',
    async (framework, name, manifest, file, code) => {
      const root = project({ 'package.json': manifest, [file]: code });
      const inventory = await scan({ root, framework });
      expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
        `No patterns were given, and no ${name} config is in the root or a folder below it, so there are no test files to find.`,
      ]);
    },
  );
});
