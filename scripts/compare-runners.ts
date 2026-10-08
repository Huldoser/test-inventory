// Usage: node scripts/compare-runners.ts <playwright|vitest> <version>
//
// Copies the fixture project for the framework to a temporary folder, installs that version of the runner, has the
// runner list the tests (Playwright) or run them with its JSON reporter (Vitest), and compares tests, states and tags
// with the inventory. Differences described in tests/compare/expected-differences.json are allowed; any other
// difference fails the run.
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scan, type Framework, type Inventory, type TestRecord } from '../src/index.ts';
import { run } from './run.ts';

interface RunnerTest {
  file: string;
  line: number;
  name: string;
  /**
   * Playwright: the status the runner expects before running anything (`passed`, `failed` or `skipped`). Vitest:
   * `ran`, `skipped` or `todo`, from running the tests.
   */
  status: string;
  /** Without the `@` Playwright tags start with. */
  tags: string[];
}

interface Difference {
  kind: 'missing-in-runner' | 'missing-in-inventory' | 'count' | 'name' | 'state' | 'tags';
  file: string;
  line: number;
  detail: string;
  test: TestRecord | null;
}

interface ExpectedDifference {
  framework?: Framework;
  kind: Difference['kind'];
  state?: string;
  file?: string;
  reason: string;
}

const PROJECTS: Record<Framework, { fixture: string; patterns: string[]; packages: (version: string) => object }> = {
  playwright: {
    fixture: 'trading-web',
    patterns: ['tests/**/*.spec.ts'],
    packages: (version) => ({ '@playwright/test': version }),
  },
  vitest: {
    fixture: 'strategy-engine',
    patterns: ['tests/**/*.{test,test-d}.ts', 'src/**/*.ts'],
    packages: (version) => ({ vitest: version, typescript: '~6.0.3', '@types/node': '^22.12.0' }),
  },
};

const repository = path.resolve(import.meta.dirname, '..');

function posix(file: string): string {
  return file.replaceAll('\\', '/');
}

interface PlaywrightSuite {
  title: string;
  file: string;
  specs?: {
    title: string;
    file: string;
    line: number;
    tags: string[];
    tests: { expectedStatus: string; annotations: { type: string }[] }[];
  }[];
  suites?: PlaywrightSuite[];
}

function playwrightTests(work: string): RunnerTest[] {
  const report = JSON.parse(run('npx', ['playwright', 'test', '--list', '--reporter=json'], work)) as {
    config: { rootDir: string };
    suites: PlaywrightSuite[];
  };
  const testDir = posix(path.relative(work, report.config.rootDir));
  const tests = new Map<string, RunnerTest>();
  const visit = (suite: PlaywrightSuite, titles: string[]) => {
    for (const spec of suite.specs ?? []) {
      const file = path.posix.join(testDir, spec.file);
      const name = [...titles, spec.title].join(' > ');
      // Each project lists the same tests again; one is enough.
      tests.set(`${file}:${spec.line}:${name}`, {
        file,
        line: spec.line,
        name,
        // The list shows tests declared with test.fail() as expected to pass, with a fail annotation.
        status: spec.tests[0].annotations.some((annotation) => annotation.type === 'fail')
          ? 'failed'
          : spec.tests[0].expectedStatus,
        tags: spec.tags.map(withoutAt),
      });
    }
    for (const child of suite.suites ?? []) visit(child, child.title ? [...titles, child.title] : titles);
  };
  // The top-level suites are the files.
  for (const file of report.suites) visit(file, []);
  return [...tests.values()];
}

interface VitestReport {
  testResults: {
    name: string;
    assertionResults: {
      ancestorTitles: string[];
      title: string;
      status: string;
      location?: { line: number } | null;
      tags?: string[];
    }[];
  }[];
}

/** Runs the tests with Vitest's JSON reporter, which lists every test, skipped and todo ones too, with its state. */
function vitestTests(work: string): RunnerTest[] {
  const output = path.join(work, 'vitest-report.json');
  try {
    run('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${output}`, '--includeTaskLocation'], work);
  } catch {
    // A failing test makes Vitest exit with 1; the report still lists every test.
  }
  const report = JSON.parse(readFileSync(output, 'utf8')) as VitestReport;
  return report.testResults.flatMap((file) => {
    const relative = posix(path.relative(work, file.name));
    return file.assertionResults.map((test) => {
      // Type tests have the file's path as their first ancestor.
      const ancestors = test.ancestorTitles[0] === relative ? test.ancestorTitles.slice(1) : test.ancestorTitles;
      return {
        file: relative,
        line: test.location?.line ?? 0,
        name: [...ancestors, test.title].join(' > '),
        status: test.status === 'todo' ? 'todo' : ['skipped', 'pending'].includes(test.status) ? 'skipped' : 'ran',
        tags: (test.tags ?? []).map(withoutAt),
      };
    });
  });
}

function withoutAt(tag: string): string {
  return tag.replace(/^@/, '');
}

/** The runner names a title stands for: `.each` titles with `%s` or `$name` become patterns that match any value. */
function titlePattern(test: TestRecord, inTable: boolean): RegExp {
  const escaped = test.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const formatted = test.isParameterized || inTable ? escaped.replace(/%[sdifjoO#%]|\\\$[\w.]+/g, '.*') : escaped;
  return new RegExp(`^${formatted}$`, 's');
}

/** Whether a describe around the test is declared with `.each` or `.for`, so the runner repeats the test per case. */
function inDescribeTable(inventory: Inventory, test: TestRecord): boolean {
  const suites = new Map(inventory.suites.map((suite) => [suite.id, suite]));
  for (let suite = suites.get(test.suiteId ?? ''); suite; suite = suites.get(suite.parentId ?? '')) {
    if (suite.isParameterized) return true;
  }
  return false;
}

/** The status the runner should report for a record; null when a condition decides it. */
function expectedStatus(test: TestRecord, framework: Framework): string | null {
  if (test.isConditional) return null;
  if (framework === 'vitest') return test.isTodo ? 'todo' : test.isSkipped ? 'skipped' : 'ran';
  if (test.isSkipped || test.isFixme) return 'skipped';
  return test.isExpectedToFail ? 'failed' : 'passed';
}

function compare(inventory: Inventory, listed: RunnerTest[]): Difference[] {
  const { framework } = inventory;
  const explained = new Set(inventory.diagnostics.flatMap((diagnostic) => diagnostic.testId ?? []));
  const differences: Difference[] = [];
  const matched = new Set<RunnerTest>();
  for (const test of inventory.tests) {
    const inTable = inDescribeTable(inventory, test);
    const pattern = titlePattern(test, inTable);
    // Vitest 3 lists type tests without a location, so those are matched by name.
    const candidates = listed.filter(
      (item) =>
        item.file === test.relativeFilePath &&
        (item.line === 0 ? pattern.test(item.name) : item.line >= test.lineStart && item.line <= test.lineEnd),
    );
    candidates.forEach((item) => matched.add(item));
    const at = { file: test.relativeFilePath, line: test.lineStart, test };
    if (candidates.length === 0) {
      differences.push({ kind: 'missing-in-runner', ...at, detail: `${test.fullName} (${test.state})` });
      continue;
    }
    // Loops and tables the scanner could not count may list any number of tests; caseCount includes describe tables.
    const count = test.isInLoop ? null : test.isParameterized ? test.caseCount : 1;
    if (count !== null && candidates.length !== count) {
      differences.push({
        kind: 'count',
        ...at,
        detail: `${test.fullName}: ${count} expected, ${candidates.length} listed`,
      });
    }
    // A diagnostic about the title already says it may differ.
    if (!test.hasDynamicTitle && !explained.has(test.id)) {
      const wrong = candidates.filter((item) => !pattern.test(item.name));
      for (const item of wrong) differences.push({ kind: 'name', ...at, detail: `${test.fullName} / ${item.name}` });
    }
    const status = expectedStatus(test, framework);
    const tags = test.tags.map(withoutAt).sort().join(', ');
    for (const item of candidates) {
      if (status !== null && item.status !== status) {
        differences.push({ kind: 'state', ...at, detail: `${test.fullName}: ${test.state} / ${item.status}` });
      }
      // A diagnostic about the test, such as an unresolved tag, already says its tags may differ.
      if (!explained.has(test.id) && [...item.tags].sort().join(', ') !== tags) {
        differences.push({ kind: 'tags', ...at, detail: `${test.fullName}: [${tags}] / [${item.tags.join(', ')}]` });
      }
    }
  }
  for (const item of listed.filter((entry) => !matched.has(entry))) {
    differences.push({ kind: 'missing-in-inventory', file: item.file, line: item.line, detail: item.name, test: null });
  }
  return differences;
}

function isExpected(
  difference: Difference,
  framework: Framework,
  expected: ExpectedDifference[],
): ExpectedDifference | undefined {
  return expected.find(
    (rule) =>
      rule.kind === difference.kind &&
      (rule.framework === undefined || rule.framework === framework) &&
      (rule.state === undefined || rule.state === difference.test?.state) &&
      (rule.file === undefined || rule.file === difference.file),
  );
}

async function main(): Promise<void> {
  const [framework, version = ''] = process.argv.slice(2);
  if ((framework !== 'playwright' && framework !== 'vitest') || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Usage: node scripts/compare-runners.ts <playwright|vitest> <version>');
  }
  const project = PROJECTS[framework];
  const work = mkdtempSync(path.join(tmpdir(), `test-inventory-${framework}-${version}-`));
  try {
    cpSync(path.join(repository, 'tests/fixtures', project.fixture), work, { recursive: true });
    const manifest = JSON.parse(readFileSync(path.join(work, 'package.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify({ ...manifest, devDependencies: project.packages(version) }),
    );
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], work);

    const listed = framework === 'playwright' ? playwrightTests(work) : vitestTests(work);
    const inventory = await scan({ root: work, patterns: project.patterns, framework });
    const differences = compare(inventory, listed);
    const rules = JSON.parse(
      readFileSync(path.join(repository, 'tests/compare/expected-differences.json'), 'utf8'),
    ) as ExpectedDifference[];

    const lines = [
      `### ${framework} ${version}`,
      '',
      `${inventory.tests.length} records, ${listed.length} tests listed by the runner, ${differences.length} differences.`,
      '',
    ];
    let unexpected = 0;
    for (const difference of differences) {
      const rule = isExpected(difference, framework, rules);
      if (!rule) unexpected++;
      lines.push(
        `- ${rule ? 'expected' : '**unexpected**'} ${difference.kind} at ${difference.file}:${difference.line}: ${difference.detail}${rule ? ` (${rule.reason})` : ''}`,
      );
    }
    const report = `${lines.join('\n')}\n`;
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    if (unexpected > 0) process.exitCode = 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
