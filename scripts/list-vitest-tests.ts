// Usage: node scripts/list-vitest-tests.ts <root> <patterns as JSON> <ignore as JSON>
//
// Lists a project's tests with Vitest's static parser, the one `vitest list` uses, and prints them as JSON: each test
// file with the errors Vitest gives for it, and each test with its full name, location and mode. Nothing is installed
// and no test runs. `vitest list` itself writes nothing when one file fails, and leaves out skipped tests, so this
// calls the API.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVitest } from 'vitest/node';

const [root, patterns, ignore] = process.argv.slice(2);
// The project's own tsconfig may extend a package that isn't installed.
const folder = mkdtempSync(path.join(tmpdir(), 'test-inventory-vitest-list-'));
const tsconfig = path.join(folder, 'tsconfig.json');
writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { jsx: 'react-jsx', target: 'esnext', module: 'esnext' } }));

// The parser reads only each file's own code, so an import of a package, which isn't installed, is an empty module.
const packagesAsEmptyModules = {
  name: 'packages-as-empty-modules',
  enforce: 'pre' as const,
  resolveId(id: string) {
    const local = id.startsWith('.') || id.startsWith('/') || id.startsWith('\0');
    return local || /^vitest(\/|$)/.test(id) ? null : `\0empty:${id}`;
  },
  load(id: string) {
    return id.startsWith('\0empty:') ? 'export default {}' : null;
  },
};

const vitest = await createVitest(
  {
    config: false,
    root,
    watch: false,
    includeTaskLocation: true,
    allowOnly: true,
    strictTags: false,
    passWithNoTests: true,
    include: JSON.parse(patterns) as string[],
    exclude: JSON.parse(ignore) as string[],
  },
  { plugins: [packagesAsEmptyModules], tsconfig, logLevel: 'silent' },
);
try {
  const modules = await vitest.parseSpecifications(await vitest.globTestSpecifications());
  const listed = modules.map((module) => ({
    file: path.relative(root, module.moduleId).replaceAll('\\', '/'),
    errors: module.errors().map((error) => error.message.split('\n')[0]),
    tests: [...module.children.allTests()].map((test) => ({
      name: test.fullName,
      line: test.location?.line ?? 0,
      column: test.location?.column ?? 0,
      mode: test.options.mode,
    })),
  }));
  process.stdout.write(JSON.stringify(listed));
} finally {
  await vitest.close();
  rmSync(folder, { recursive: true, force: true });
}
