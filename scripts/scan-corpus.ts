// Usage: node scripts/scan-corpus.ts
//
// Clones the public projects listed in tests/compare/corpus.json at their pinned commits, scans them and reports
// counts, diagnostics, time and memory. The code is never copied into this repository. Fails when a project gets a
// parse-error or internal-error diagnostic, which means the scanner could not read code that its runner accepts;
// when it finds fewer files or tests than corpus.json records; or when a file that calls something shaped like a
// test gets no test record and no error that explains why.
//
// Vitest projects are also listed with Vitest's own static parser, which needs no install, and the list is compared
// with a scan that applies the rules of the same Vitest version. A difference that no known cause in
// scripts/compare-vitest-list.ts explains fails the run too.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Node } from 'oxc-parser';
import { glob } from 'tinyglobby';
import { childNodes } from '../src/ast.ts';
import { scan, type Framework } from '../src/index.ts';
import { parseFile } from '../src/parse.ts';
import { compareWithVitest, type Difference, type ListedModule } from './compare-vitest-list.ts';
import { run } from './run.ts';

interface Project {
  name: string;
  repository: string;
  commit: string;
  license: string;
  framework: Framework;
  patterns: string[];
  /** Folders of test inputs, such as files with syntax errors on purpose, that the project's runner never loads. */
  ignore?: string[];
  /** Counts from the last reviewed scan. Fewer files or tests than these fails the run. */
  expected: { files: number; tests: number };
}

const TEST_NAMES = new Set(['test', 'it', 'describe']);

/** The name a call chain starts with: `test` for `test.describe.skip(...)` and `describe.each(table)(...)`. */
function chainStart(node: Node): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return chainStart(node.object);
  return node.type === 'CallExpression' ? chainStart(node.callee) : null;
}

/** Whether the code calls `test`, `it` or `describe`, or a member of one; comments and strings don't count. */
function hasTestShapedCall(file: string, code: string): boolean {
  const visit = (node: Node): boolean =>
    (node.type === 'CallExpression' && TEST_NAMES.has(chainStart(node.callee) ?? '')) || childNodes(node).some(visit);
  return visit(parseFile(file, code).program);
}

/** The Vitest that lists the Vitest projects: the one this repository installs. */
const vitestVersion = (
  JSON.parse(readFileSync(createRequire(import.meta.url).resolve('vitest/package.json'), 'utf8')) as { version: string }
).version;

/** Lists a Vitest project with Vitest's parser and compares the list with a scan under that Vitest version's rules. */
async function compareWithVitestList(
  project: Project,
  checkout: string,
): Promise<{ listed: number; differences: Difference[] }> {
  const ignore = ['**/node_modules/**', ...(project.ignore ?? [])];
  const script = path.join(import.meta.dirname, 'list-vitest-tests.ts');
  const output = run('node', [script, checkout, JSON.stringify(project.patterns), JSON.stringify(ignore)], checkout);
  const modules = JSON.parse(output) as ListedModule[];
  const inventory = await scan({
    root: checkout,
    patterns: project.patterns,
    ignore: project.ignore,
    framework: 'vitest',
    frameworkVersion: vitestVersion,
  });
  const listed = modules.reduce((count, module) => count + module.tests.length, 0);
  return { listed, differences: compareWithVitest(checkout, inventory, modules) };
}

const projects = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../tests/compare/corpus.json'), 'utf8'),
) as Project[];
const work = mkdtempSync(path.join(tmpdir(), 'test-inventory-corpus-'));
const lines = [
  '### Public projects',
  '',
  '| Project | Files | Tests | Time | Diagnostics |',
  '| --- | --- | --- | --- | --- |',
];
const problems: string[] = [];
const compared = [
  `### Compared with Vitest ${vitestVersion}'s static parser`,
  '',
  '| Project | Listed by Vitest | Differences | Unexplained |',
  '| --- | --- | --- | --- |',
];
const causes = new Map<string, number>();

try {
  for (const project of projects) {
    const checkout = path.join(work, project.commit);
    // Two entries may scan different parts of the same checkout.
    if (!existsSync(checkout)) {
      mkdirSync(checkout);
      run('git', ['init', '--quiet'], checkout);
      run('git', ['fetch', '--quiet', '--depth', '1', project.repository, project.commit], checkout);
      run('git', ['checkout', '--quiet', 'FETCH_HEAD'], checkout);
    }
    const started = performance.now();
    const inventory = await scan({
      root: checkout,
      patterns: project.patterns,
      ignore: project.ignore,
      framework: project.framework,
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(2);
    const byCode = new Map<string, number>();
    for (const diagnostic of inventory.diagnostics) byCode.set(diagnostic.code, (byCode.get(diagnostic.code) ?? 0) + 1);
    for (const item of inventory.diagnostics) {
      if (item.code === 'parse-error' || item.code === 'internal-error') {
        problems.push(`${project.name}: ${item.relativeFilePath}: ${item.message}`);
      }
    }
    const { fileCount, testCount } = inventory.summary;
    if (fileCount < project.expected.files) {
      problems.push(`${project.name}: ${fileCount} files, ${project.expected.files} expected.`);
    }
    if (testCount < project.expected.tests) {
      problems.push(`${project.name}: ${testCount} tests, ${project.expected.tests} expected.`);
    }
    if (fileCount > project.expected.files || testCount > project.expected.tests) {
      console.log(`${project.name}: ${fileCount} files and ${testCount} tests; update corpus.json once reviewed.`);
    }
    const withTests = new Set(inventory.tests.map((test) => test.relativeFilePath));
    const withErrors = new Set(
      inventory.diagnostics.filter((item) => item.level === 'error').map((item) => item.relativeFilePath),
    );
    const files = await glob(project.patterns, {
      cwd: checkout,
      ignore: ['**/node_modules/**', ...(project.ignore ?? [])],
      onlyFiles: true,
      expandDirectories: false,
    });
    for (const file of files.sort()) {
      if (withTests.has(file) || withErrors.has(file)) continue;
      if (hasTestShapedCall(file, readFileSync(path.join(checkout, file), 'utf8'))) {
        problems.push(`${project.name}: ${file} calls something shaped like a test, but no test was found in it.`);
      }
    }
    const codes = [...byCode].map(([code, count]) => `${code} ${count}`).join(', ') || 'none';
    lines.push(
      `| ${project.name} (${project.framework}, ${project.commit.slice(0, 8)}) | ${fileCount} | ${testCount} | ${seconds} s | ${codes} |`,
    );
    if (project.framework === 'vitest') {
      const { listed, differences } = await compareWithVitestList(project, checkout);
      const unexplained = differences.filter((difference) => difference.cause === null);
      compared.push(`| ${project.name} | ${listed} | ${differences.length} | ${unexplained.length} |`);
      for (const { cause } of differences) if (cause) causes.set(cause, (causes.get(cause) ?? 0) + 1);
      for (const { at, detail } of unexplained) {
        problems.push(`${project.name}: ${at}: Vitest's list and the scan differ, for no known reason: ${detail}`);
      }
    }
  }
  lines.push('', ...compared, '', '| Known cause | Differences |', '| --- | --- |');
  for (const [cause, count] of [...causes].sort((a, b) => b[1] - a[1])) lines.push(`| ${cause} | ${count} |`);
  lines.push('', `Peak memory: ${Math.round(process.resourceUsage().maxRSS / 1024)} MB.`);
  if (problems.length > 0) lines.push('', '#### Problems', '', ...problems.map((problem) => `- ${problem}`));
  const report = `${lines.join('\n')}\n`;
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  if (problems.length > 0) process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
