// Packs the package, checks that it holds exactly the files it should, installs the tarball in an empty project and
// uses it the way people will: the CLI, the library and the schema export.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from './run.ts';

const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
const work = mkdtempSync(path.join(tmpdir(), 'test-inventory-pack-'));

/** Each source file becomes a module and its types; nothing else from the repository is published. */
function expectedFiles(): string[] {
  const modules = readdirSync(path.join(root, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `dist/${file.replaceAll('\\', '/').replace(/\.ts$/, '')}`);
  const files = modules.flatMap((module) => [`${module}.js`, `${module}.d.ts`]);
  return [
    ...files,
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'package.json',
    'schema/v1.json',
    'schema/diff-v1.json',
  ].sort();
}

try {
  const [{ filename, files }] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], root)) as {
    filename: string;
    files: { path: string }[];
  }[];
  assert.deepEqual(files.map((file) => file.path).sort(), expectedFiles());
  const app = path.join(work, 'app');
  mkdirSync(path.join(app, 'tests'), { recursive: true });
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'pack-smoke', private: true, type: 'module' }));
  writeFileSync(
    path.join(app, 'tests', 'orders.spec.ts'),
    "import { test } from '@playwright/test';\ntest('places a market order @smoke', async () => {});\n",
  );
  run('npm', ['install', '--no-audit', '--no-fund', path.join(work, filename)], app);

  // Paths of the machine that built the package must not end up in it.
  const installed = path.join(app, 'node_modules', 'test-inventory');
  for (const file of files) {
    const text = readFileSync(path.join(installed, file.path), 'utf8');
    assert.doesNotMatch(text, /\/home\/[\w.-]+\/|\/Users\/[\w.-]+\/|[A-Z]:\\Users\\/i, file.path);
  }

  assert.equal(run('npx', ['test-inventory', '--version'], app).trim(), version);
  const output = JSON.parse(
    run(
      'npx',
      ['test-inventory', 'tests/*.spec.ts', '--framework', 'playwright', '--framework-version', '1.63.0'],
      app,
    ),
  ) as { summary: { testCount: number }; tests: { tags: string[] }[] };
  assert.equal(output.summary.testCount, 1);
  assert.deepEqual(output.tests[0].tags, ['@smoke']);
  writeFileSync(path.join(app, 'before.json'), JSON.stringify(output));
  writeFileSync(
    path.join(app, 'tests', 'orders.spec.ts'),
    "import { test } from '@playwright/test';\ntest('routes a market order @smoke', async () => {});\n",
  );
  run(
    'npx',
    [
      'test-inventory',
      'tests/*.spec.ts',
      '--framework',
      'playwright',
      '--framework-version',
      '1.63.0',
      '-o',
      'after.json',
    ],
    app,
  );
  const diff = JSON.parse(run('npx', ['test-inventory', 'diff', 'before.json', 'after.json'], app)) as {
    summary: { renamed: number };
  };
  assert.equal(diff.summary.renamed, 1);
  assert.match(
    run('npx', ['test-inventory', 'diff', 'before.json', 'after.json', '--format', 'markdown'], app),
    /routes a market order/,
  );

  writeFileSync(
    path.join(app, 'library.mjs'),
    `import { scanSource, diffInventories } from 'test-inventory';
import schema from 'test-inventory/schema/v1.json' with { type: 'json' };
import diffSchema from 'test-inventory/schema/diff-v1.json' with { type: 'json' };
const inventory = scanSource({
  code: "import { test } from 'vitest';\\ntest.todo('charges a borrow fee');",
  relativeFilePath: 'tests/fees.test.ts',
  framework: 'vitest',
});
console.log(JSON.stringify({ state: inventory.tests[0].state, schemaId: schema.$id, diffSchemaId: diffSchema.$id, unchanged: diffInventories(inventory, inventory).summary.unchanged }));
`,
  );
  assert.deepEqual(JSON.parse(run(process.execPath, ['library.mjs'], app)), {
    state: 'todo',
    schemaId: 'https://huldoser.github.io/test-inventory/schema/v1.json',
    diffSchemaId: 'https://huldoser.github.io/test-inventory/schema/diff-v1.json',
    unchanged: 1,
  });
  console.log(`${filename}: the CLI, the library and the schema work from the installed tarball.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
