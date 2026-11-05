// Usage: node scripts/compare-runners.ts <playwright|vitest|jest|mocha|jasmine|cypress> <version>
//
// Copies the fixture project for the framework to a temporary folder, installs that version of the runner, has the
// runner list the tests (Playwright) or run them with its JSON reporter (Vitest, Jest) or one of ours (Mocha, Jasmine,
// Cypress), and compares tests, states and tags with the inventory, scanned once as it is by default and once with
// expandCases, whose cases must have the runner's names. Differences described in
// tests/compare/expected-differences.json are allowed; any other difference fails the run.
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scan, type Framework, type Inventory, type TestRecord } from '../src/index.ts';
import { run } from './run.ts';

interface RunnerTest {
  file: string;
  line: number;
  name: string;
  /**
   * Playwright: the status the runner expects before running anything (`passed`, `failed` or `skipped`). The others:
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
  /** Where the state comes from, as `suite` for a describe around the test. */
  stateSource?: string;
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
  jest: {
    fixture: 'settlement-service',
    patterns: ['src/**/*.test.js', 'src/__tests__/*.js', 'tests/**/*.test.js'],
    packages: (version) => ({ jest: version }),
  },
  mocha: {
    fixture: 'fix-gateway',
    patterns: ['test/**/*.spec.js'],
    packages: (version) => ({ mocha: version }),
  },
  jasmine: {
    fixture: 'risk-service',
    patterns: ['spec/*.spec.js', 'spec/limits/**/*.spec.js'],
    packages: (version) => ({ jasmine: version }),
  },
  cypress: {
    fixture: 'trading-ui-cypress',
    patterns: ['cypress/e2e/**/*.cy.js'],
    packages: (version) => ({ cypress: version }),
  },
  webdriverio: {
    fixture: 'broker-portal',
    patterns: ['test/specs/*.e2e.js', 'test/specs/{orders,accounts}/*.e2e.js'],
    packages: (version) => ({
      '@wdio/cli': version,
      '@wdio/local-runner': version,
      '@wdio/mocha-framework': version,
    }),
  },
  // node:test ships with Node.js, so CI picks the version with setup-node; this checks it runs the one asked for.
  node: {
    fixture: 'pricing-service',
    patterns: ['test/**/*.js', 'src/**/*.test.js'],
    packages: () => ({}),
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

interface JestReport {
  testResults: {
    name: string;
    assertionResults: { ancestorTitles: string[]; title: string; status: string; location?: { line: number } | null }[];
  }[];
}

/** Runs the tests with Jest's JSON output, which lists every test with its state and, asked to, its line. */
function jestTests(work: string): RunnerTest[] {
  const output = path.join(work, 'jest-report.json');
  try {
    run('npx', ['jest', '--json', `--outputFile=${output}`, '--testLocationInResults'], work);
  } catch {
    // A failing test makes Jest exit with 1; the report still lists every test.
  }
  const report = JSON.parse(readFileSync(output, 'utf8')) as JestReport;
  return report.testResults.flatMap((file) =>
    file.assertionResults.map((test) => ({
      file: posix(path.relative(work, file.name)),
      line: test.location?.line ?? 0,
      name: [...test.ancestorTitles, test.title].join(' > '),
      status:
        test.status === 'todo' ? 'todo' : ['skipped', 'pending', 'disabled'].includes(test.status) ? 'skipped' : 'ran',
      // Jest reports no tags; jest-runner-groups only picks the files to run.
      tags: [],
    })),
  );
}

/**
 * Runs the tests with a reporter of our own, which lists every test Mocha registered with its titles; a test that calls
 * `this.skip()` is skipped only once it runs, which `--dry-run` doesn't do. Mocha gives no line, so tests are matched
 * by name.
 */
function mochaTests(work: string): RunnerTest[] {
  try {
    run('npx', ['mocha', '--reporter', path.join(repository, 'scripts/mocha-reporter.cjs')], work);
  } catch {
    // A failing test makes Mocha exit with the number of failures; the reporter still wrote every test.
  }
  const tests = JSON.parse(readFileSync(path.join(work, 'mocha-tests.json'), 'utf8')) as {
    file: string;
    titles: string[];
    pending: boolean;
  }[];
  return tests.map((test) => ({
    file: posix(path.relative(work, test.file)),
    line: 0,
    name: test.titles.join(' > '),
    status: test.pending ? 'skipped' : 'ran',
    tags: [],
  }));
}

/**
 * Runs the specs with a reporter of our own, which lists every spec with its titles and file. Jasmine gives no line,
 * so specs are matched by name; pending, excluded and not applicable specs didn't run.
 */
function jasmineTests(work: string): RunnerTest[] {
  try {
    run('npx', ['jasmine', `--reporter=${path.join(repository, 'scripts/jasmine-reporter.cjs')}`], work);
  } catch {
    // A failing spec makes Jasmine exit with 3; the reporter still wrote every spec.
  }
  const specs = JSON.parse(readFileSync(path.join(work, 'jasmine-tests.json'), 'utf8')) as {
    file: string;
    titles: string[];
    status: string;
  }[];
  return specs.map((spec) => ({
    file: posix(path.relative(work, spec.file)),
    line: 0,
    name: spec.titles.join(' > '),
    status: ['passed', 'failed'].includes(spec.status) ? 'ran' : 'skipped',
    tags: [],
  }));
}

/**
 * Runs the specs in Cypress's Electron with a reporter of our own, which Cypress starts once per spec and which adds
 * each spec's tests with their titles. Cypress gives no line, so tests are matched by name.
 */
function cypressTests(work: string): RunnerTest[] {
  try {
    run(
      'npx',
      ['cypress', 'run', '--browser', 'electron', '--reporter', path.join(repository, 'scripts/cypress-reporter.cjs')],
      work,
    );
  } catch {
    // A failing test makes Cypress exit with the number of failures; the reporter still wrote every test.
  }
  const lines = readFileSync(path.join(work, 'cypress-tests.jsonl'), 'utf8').trim().split('\n');
  return lines.map((line) => {
    const test = JSON.parse(line) as { file: string; titles: string[]; pending: boolean };
    return {
      file: posix(path.relative(work, path.resolve(work, test.file))),
      line: 0,
      name: test.titles.join(' > '),
      status: test.pending ? 'skipped' : 'ran',
      tags: [],
    };
  });
}

/**
 * WebdriverIO's tests, run with the fixture's config and a reporter of ours, in headless Chrome: a config next to the
 * fixture's takes its settings, so the specs resolve from the same folder.
 */
function webdriverioTests(work: string): RunnerTest[] {
  const output = path.join(work, 'wdio-tests.jsonl');
  const reporter = pathToFileURL(path.join(repository, 'scripts/wdio-reporter.mjs')).href;
  writeFileSync(
    path.join(work, 'wdio.compare.conf.js'),
    [
      "import { config as base } from './wdio.conf.js';",
      `import CompareReporter from ${JSON.stringify(reporter)};`,
      'export const config = {',
      '  ...base,',
      "  logLevel: 'error',",
      `  reporters: [[CompareReporter, { outputFile: ${JSON.stringify(output)} }]],`,
      "  capabilities: [{ browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox'] } }],",
      '};',
      '',
    ].join('\n'),
  );
  try {
    run('npx', ['wdio', 'run', './wdio.compare.conf.js'], work);
  } catch {
    // A failing test makes WebdriverIO exit with 1; the reporter still wrote every test.
  }
  const lines = readFileSync(output, 'utf8').trim().split('\n');
  return lines.map((line) => {
    const test = JSON.parse(line) as { file: string; titles: string[]; pending: boolean };
    return {
      file: posix(path.relative(work, test.file)),
      line: 0,
      name: test.titles.join(' > '),
      status: test.pending ? 'skipped' : 'ran',
      tags: [],
    };
  });
}

/** node:test's tests, run with a reporter of ours, which gives each test's line and the titles around it. */
function nodeTests(work: string, version: string): RunnerTest[] {
  if (process.versions.node.split('.')[0] !== version.split('.')[0]) {
    throw new Error(`Node.js ${process.versions.node} runs this, not ${version}; set it up with setup-node.`);
  }
  const output = path.join(work, 'node-tests.jsonl');
  const reporter = pathToFileURL(path.join(repository, 'scripts/node-reporter.mjs')).href;
  try {
    run('node', ['--test', `--test-reporter=${reporter}`, `--test-reporter-destination=${output}`], work);
  } catch {
    // A failing test makes node --test exit with 1; the reporter still wrote every test.
  }
  return readFileSync(output, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const test = JSON.parse(line) as { file: string; line: number; titles: string[]; status: string };
      return {
        file: posix(path.relative(work, test.file)),
        line: test.line,
        name: test.titles.join(' > '),
        status: test.status,
        tags: [],
      };
    });
}

function withoutAt(tag: string): string {
  return tag.replace(/^@/, '');
}

function exactly(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 's');
}

/**
 * The runner names a title stands for: `.each` titles with `%s` or `$name` become patterns that match any value, and a
 * template literal kept as source text, as a test in a loop has, matches any value of each `${...}`. Mocha gives no
 * line, so names are all it is matched by.
 */
function titlePattern(test: TestRecord, inTable: boolean): RegExp {
  const escaped = test.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const formatted = test.isParameterized || inTable ? escaped.replace(/%[sdifjoOp#%]|\\\$[\w.]+/g, '.*') : escaped;
  const template = test.hasDynamicTitle
    ? formatted.replace(/`([^`]*)`/g, (_, inner: string) => inner.replace(/\\\$\\\{[^`]*?\\\}/g, '.*'))
    : formatted;
  return new RegExp(`^${template}$`, 's');
}

/** Whether the test is one case of a table or pass of a loop, or in a describe that is, so its title is the runner's. */
function isExpanded(inventory: Inventory, test: TestRecord): boolean {
  const suites = new Map(inventory.suites.map((suite) => [suite.id, suite]));
  for (let suite = suites.get(test.suiteId ?? ''); suite; suite = suites.get(suite.parentId ?? '')) {
    if (suite.caseIndex !== null) return true;
  }
  return test.caseIndex !== null;
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
  if (framework === 'node' && test.isExpectedToFail) return 'expectedToFail';
  if (framework !== 'playwright') return test.isTodo ? 'todo' : test.isSkipped ? 'skipped' : 'ran';
  if (test.isSkipped || test.isFixme) return 'skipped';
  return test.isExpectedToFail ? 'failed' : 'passed';
}

function compare(inventory: Inventory, listed: RunnerTest[]): Difference[] {
  const { framework } = inventory;
  const explained = new Set(inventory.diagnostics.flatMap((diagnostic) => diagnostic.testId ?? []));
  const differences: Difference[] = [];
  const matched = new Set<RunnerTest>();
  for (const test of inventory.tests) {
    const expanded = isExpanded(inventory, test);
    const pattern = expanded ? exactly(test.fullName) : titlePattern(test, inDescribeTable(inventory, test));
    // Vitest 3 lists type tests without a location, so those are matched by name, as the cases of one declaration are.
    const candidates = listed.filter(
      (item) =>
        item.file === test.relativeFilePath &&
        // node:test gives lines, but a subtest's is inside its parent's, so the name tells them apart.
        (item.line === 0 || expanded || framework === 'node' ? pattern.test(item.name) : true) &&
        (item.line === 0 || (item.line >= test.lineStart && item.line <= test.lineEnd)),
    );
    candidates.forEach((item) => matched.add(item));
    const at = { file: test.relativeFilePath, line: test.lineStart, test };
    if (candidates.length === 0) {
      differences.push({ kind: 'missing-in-runner', ...at, detail: `${test.fullName} (${test.state})` });
      continue;
    }
    // Loops and tables the scanner could not count may list any number of tests; caseCount includes describe tables
    // and loops.
    const count = test.caseCount ?? (test.isInLoop || test.isParameterized ? null : 1);
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
    // Only Playwright and Vitest report tags, so only theirs are compared.
    const tags = ['playwright', 'vitest'].includes(framework) ? test.tags.map(withoutAt).sort().join(', ') : '';
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
      (rule.stateSource === undefined || rule.stateSource === difference.test?.stateSource) &&
      (rule.file === undefined || rule.file === difference.file),
  );
}

async function main(): Promise<void> {
  const [name, version = ''] = process.argv.slice(2);
  if (!Object.hasOwn(PROJECTS, name) || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Usage: node scripts/compare-runners.ts <playwright|vitest|jest|mocha|jasmine|cypress> <version>');
  }
  const framework = name as Framework;
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

    const listers = {
      playwright: playwrightTests,
      vitest: vitestTests,
      jest: jestTests,
      mocha: mochaTests,
      jasmine: jasmineTests,
      cypress: cypressTests,
      webdriverio: webdriverioTests,
      node: (work: string) => nodeTests(work, version),
    };
    const listed = listers[framework](work);
    const rules = JSON.parse(
      readFileSync(path.join(repository, 'tests/compare/expected-differences.json'), 'utf8'),
    ) as ExpectedDifference[];
    const lines = [`### ${framework} ${version}`, ''];
    let unexpected = 0;
    for (const expandCases of [false, true]) {
      // node:test has no package to read its version from; it is the Node.js running the comparison.
      const frameworkVersion = framework === 'node' ? process.versions.node : undefined;
      const inventory = await scan({
        root: work,
        patterns: project.patterns,
        framework,
        expandCases,
        frameworkVersion,
      });
      const differences = compare(inventory, listed);
      lines.push(
        `${expandCases ? 'With expandCases: ' : ''}${inventory.tests.length} records, ${listed.length} tests listed by the runner, ${differences.length} differences.`,
        '',
      );
      for (const difference of differences) {
        const rule = isExpected(difference, framework, rules);
        if (!rule) unexpected++;
        lines.push(
          `- ${rule ? 'expected' : '**unexpected**'} ${difference.kind} at ${difference.file}:${difference.line}: ${difference.detail}${rule ? ` (${rule.reason})` : ''}`,
        );
      }
      if (differences.length > 0) lines.push('');
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
