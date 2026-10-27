import type { CallExpression, FunctionBody, Node } from 'oxc-parser';
import type { FunctionNode } from './ast.ts';
import { REJECTS_FILE, toDiagnostic } from './diagnostics.ts';
import {
  anySlow,
  eitherCondition,
  noHooks,
  type DeclaredAt as Written,
  type Extraction,
  type PendingSuite,
  type PendingTest,
  type Scope,
} from './extract.ts';
import { problem } from './frameworks/common.ts';
import { hashNodes, shortHash } from './hash.ts';
import type { Problem, RunSettings, Span, StateSetting } from './model.ts';
import type { ParsedFile } from './parse.ts';
import { snippet } from './source.ts';
import type {
  DeclaredAt,
  Diagnostic,
  FileRecord,
  Framework,
  HookCounts,
  MetaValue,
  SettingSource,
  StateSource,
  SuiteRecord,
  TestRecord,
  TestState,
} from './types.ts';

/** @inline */
export type CommentsMode = 'all' | 'non-active' | 'none';

export interface FileRecords {
  file: FileRecord;
  suites: SuiteRecord[];
  tests: TestRecord[];
  diagnostics: Diagnostic[];
}

/** What the config the file uses sets for its tests, where the file sets nothing. */
export interface ConfigDefaults {
  /** A run setting the config sets; null when its projects set different values or it depends on a condition. */
  timeout?: number | null;
  retry?: RunSettings['retry'] | null;
  repeats?: number | null;
  /** Whether tests run in parallel unless the file says otherwise: Playwright's `fullyParallel`, Vitest's `sequence.concurrent`. */
  parallel: boolean;
}

/** What the config the file uses gives it. */
export interface FileConfig {
  /** Whether a `.only` fails the run: Playwright's `forbidOnly`, always, never, or under the condition with this text. */
  forbidOnly: boolean | string;
  /** The names of the projects that run a test, null when unknown, and what they set for it. */
  forTest(test: TestRecord, suites: SuiteRecord[]): { projects: string[] | null; defaults: ConfigDefaults | null };
}

interface RecordOptions {
  relativeFilePath: string;
  framework: Framework;
  comments: CommentsMode;
  isTypeTest: boolean;
  /** A Vitest 5 benchmark file, such as `*.bench.ts`. */
  isBenchmarkFile: boolean;
  config: FileConfig | null;
}

interface Chosen {
  setting: StateSetting;
  source: StateSource;
}

/**
 * The state the runner applies, from the candidates nearest the test first. An unconditional skip, fixme or todo wins
 * over an unconditional expected failure, since the test doesn't run, and one set while the file loads wins over one
 * in a test or hook body, which then never runs; then the nearest conditional state.
 */
function chooseState(candidates: Chosen[]): Chosen | null {
  const always = candidates.filter((candidate) => candidate.setting.condition === null);
  const stops = always.filter((candidate) => candidate.setting.state !== 'expectedToFail');
  return (
    stops.find((candidate) => !candidate.setting.afterLoad) ?? stops.at(0) ?? always.at(0) ?? candidates.at(0) ?? null
  );
}

/** The scope and the scopes around it, innermost first. */
function outward(scope: Scope): Scope[] {
  const scopes: Scope[] = [];
  for (let current: Scope | null = scope; current; current = current.parent) scopes.push(current);
  return scopes;
}

function suiteOf(scope: Scope): PendingSuite {
  return scope.suite as PendingSuite;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** The statements inside a callback, or its expression when it has no block body. */
function bodyNodes(fn: FunctionNode): Node[] {
  const body = fn.body as FunctionBody | Node;
  return body.type === 'BlockStatement' ? body.body : [body];
}

/** Where a run setting of a scope is written, for a test in it: the file, or a describe. */
function placeOf(scope: Scope): SettingSource {
  return scope.kind === 'file' ? 'file' : 'suite';
}

function addHooks(scopes: Scope[]): HookCounts {
  const total = noHooks();
  for (const scope of scopes) {
    for (const name of Object.keys(total) as (keyof HookCounts)[]) total[name] += scope.hooks[name];
  }
  return total;
}

type RunKeys = Pick<
  TestRecord,
  'timeout' | 'isSlow' | 'slowCondition' | 'retries' | 'retryDelay' | 'retryCondition' | 'repeats'
>;

/**
 * The run settings that apply, from the places that set them, nearest first: the first that sets a key wins, and any
 * `test.slow()` makes the test slow.
 */
function runKeys(places: RunSettings[]): RunKeys {
  const first = <K extends keyof RunSettings>(key: K) => places.find((place) => place[key] !== undefined)?.[key];
  const retry = first('retry');
  const slows = places.flatMap((place) => place.slow ?? []);
  return {
    timeout: first('timeout') ?? null,
    isSlow: slows.length > 0,
    slowCondition: eitherCondition(anySlow(slows).conditions ?? []) || null,
    retries: retry?.count ?? null,
    retryDelay: retry?.delay ?? null,
    retryCondition: retry?.condition ?? null,
    repeats: first('repeats') ?? null,
  };
}

type RunSources = Pick<TestRecord, 'timeoutSource' | 'retriesSource' | 'repeatsSource'>;

/** A test's run settings from the file, and where each comes from: the nearest place that sets it. */
function testRun(places: { run: RunSettings; source: SettingSource }[]): RunKeys & RunSources {
  const from = (key: keyof RunSettings) => places.find((place) => place.run[key] !== undefined)?.source ?? null;
  return {
    ...runKeys(places.map((place) => place.run)),
    timeoutSource: from('timeout'),
    retriesSource: from('retry'),
    repeatsSource: from('repeats'),
  };
}

/** A test's run settings, with what the config sets where the file sets nothing. */
function withConfig<T extends RunKeys & RunSources>(fromFile: T, config: ConfigDefaults | null): T {
  const run = { ...fromFile };
  if (run.timeoutSource === null && config?.timeout !== undefined) {
    run.timeout = config.timeout;
    run.timeoutSource = 'config';
  }
  if (run.retriesSource === null && config?.retry !== undefined) {
    run.retries = config.retry?.count ?? null;
    run.retryDelay = config.retry?.delay ?? null;
    run.retryCondition = config.retry?.condition ?? null;
    run.retriesSource = 'config';
  }
  if (run.repeatsSource === null && config?.repeats !== undefined) {
    run.repeats = config.repeats;
    run.repeatsSource = 'config';
  }
  return run;
}

/** The record of a scanned file, from its records and the hooks at its top level. */
export function fileRecord(
  relativeFilePath: string,
  hooks: HookCounts,
  records: Pick<FileRecords, 'suites' | 'tests'>,
): FileRecord {
  return {
    relativeFilePath,
    fileName: relativeFilePath.slice(relativeFilePath.lastIndexOf('/') + 1),
    config: null,
    hooks,
    suiteCount: records.suites.length,
    testCount: records.tests.length,
  };
}

/** Whether a function's block holds no statements; comments are not statements. */
function hasNoStatements(fn: FunctionNode | null): boolean {
  const body = fn?.body;
  return body?.type === 'BlockStatement' && body.body.length === 0;
}

/** The number of times the runner repeats a test: its own cases times those of each describe table around it. */
function repetitions(counts: (number | null)[]): number | null {
  let product: number | null = 1;
  for (const count of counts) product = product === null || count === null ? null : product * count;
  return product;
}

class RecordBuilder {
  private readonly parsed: ParsedFile;
  private readonly options: RecordOptions;
  private readonly fileName: string;
  private readonly ordinals = new Map<string, number>();
  private readonly suiteIds = new Map<Scope, string>();
  private readonly diagnostics: Diagnostic[] = [];
  /** The line of the first problem for which the runner refuses the file; null when it loads. */
  private rejectedAt: number | null = null;

  constructor(parsed: ParsedFile, options: RecordOptions) {
    this.parsed = parsed;
    this.options = options;
    this.fileName = options.relativeFilePath.slice(options.relativeFilePath.lastIndexOf('/') + 1);
  }

  build(extraction: Extraction): FileRecords {
    const duplicates = this.duplicates(extraction.tests);
    const rejecting = [
      ...extraction.problems,
      ...extraction.tests.flatMap((test) => test.problems),
      ...duplicates.map((item) => item.problem),
    ].filter((item) => REJECTS_FILE[this.options.framework].has(item.code) && item.afterLoad !== true);
    // Each of these problems points at the code that causes it.
    const lines = rejecting.map((item) => this.parsed.source.line((item.node as Span).start));
    if (lines.length > 0) this.rejectedAt = Math.min(...lines);
    const suites = extraction.suites.map((suite) => this.suite(suite));
    const tests = extraction.tests.map((test) => this.test(test, suites));
    for (const item of extraction.problems) this.diagnostics.push(this.diagnostic(item));
    for (const { index, problem: item } of duplicates) {
      this.diagnostics.push(this.diagnostic(item, tests[index].id));
    }
    this.diagnostics.push(...duplicateIdDiagnostics([...suites, ...tests], this.options.relativeFilePath));
    // Diagnostics for the whole file have no line, which sorts as 0, before the others.
    const diagnostics = this.diagnostics.sort(
      (a, b) => Number(a.lineStart) - Number(b.lineStart) || Number(a.columnStart) - Number(b.columnStart),
    );
    return {
      file: fileRecord(this.options.relativeFilePath, extraction.hooks, { suites, tests }),
      suites,
      tests,
      diagnostics,
    };
  }

  private diagnostic(item: Problem, testId: string | null = null): Diagnostic {
    return toDiagnostic(item, this.options.relativeFilePath, this.parsed.source, testId);
  }

  private position(node: Span) {
    const start = this.parsed.source.position(node.start);
    const end = this.parsed.source.position(node.end);
    return { lineStart: start.line, lineEnd: end.line, columnStart: start.column, columnEnd: end.column };
  }

  private declaredAt(written: Written | null): DeclaredAt | null {
    if (!written) return null;
    const { line, column } = written.source.position(written.start);
    return { relativeFilePath: written.relativeFilePath, lineStart: line, columnStart: column };
  }

  /** Each describe's titles without tags, outermost first; anonymous describes are left out. */
  private describeTitles(scopes: Scope[]): string[] {
    return scopes.flatMap((scope) => suiteOf(scope).declaration.title?.withoutTags ?? []);
  }

  private id(parts: unknown[]): string {
    const key = JSON.stringify(parts);
    const ordinal = this.ordinals.get(key) ?? 0;
    this.ordinals.set(key, ordinal + 1);
    return shortHash(JSON.stringify([this.options.relativeFilePath, ...parts, ordinal]));
  }

  /**
   * Reports a `.only` that the config's `forbidOnly` makes fail the run, at `located`; one under a condition is a
   * warning. `call` is the `.only` call when it is in this file, whose callee the diagnostic shows.
   */
  private forbidOnly(located: Span, call: CallExpression | null): void {
    const forbid = this.options.config?.forbidOnly ?? false;
    if (forbid === false) return;
    const message =
      forbid === true
        ? 'The config sets forbidOnly, so this .only fails the run before any test runs.'
        : `The config sets forbidOnly when ${forbid}, so then this .only fails the run before any test runs.`;
    const callee = call && snippet(this.parsed.source.text.slice(call.callee.start, call.callee.end));
    const found = problem('forbidden-only', located, message, callee);
    this.diagnostics.push(this.diagnostic(forbid === true ? found : { ...found, level: 'warning' }));
  }

  private suite(pending: PendingSuite): SuiteRecord {
    const { scope, declaration, call } = pending;
    if (declaration.isOnly) this.forbidOnly(pending.site ?? call, pending.site ? null : call);
    const parents = outward(scope).slice(1, -1).reverse();
    const title = declaration.title;
    // Suite ids are marked so that a describe and a test with the same title in the same place differ.
    const id = this.id(['describe', this.describeTitles(parents), title?.withoutTags ?? '']);
    this.suiteIds.set(scope, id);
    const chosen = chooseState(scope.states.map((setting) => ({ setting, source: 'suite' as const })));
    const state = chosen?.setting.state;
    const fn = declaration.fn;
    return {
      id,
      parentId: parents.length > 0 ? (this.suiteIds.get(parents[parents.length - 1]) as string) : null,
      bodyHash: fn ? hashNodes(bodyNodes(fn), pending.cuts) : null,
      relativeFilePath: this.options.relativeFilePath,
      fileName: this.fileName,
      ...this.position(pending.site ?? call),
      declaredAt: this.declaredAt(pending.declaredAt),
      title: title?.text ?? '',
      titleWithoutTags: title?.withoutTags ?? '',
      hasDynamicTitle: title?.isDynamic ?? false,
      path: [...parents, scope].flatMap((item) => suiteOf(item).declaration.title?.text ?? []),
      isSkipped: state === 'skip',
      isFixme: state === 'fixme',
      isTodo: state === 'todo',
      isExpectedToFail: state === 'expectedToFail',
      isOnly: scope.isOnly,
      isConditional: (chosen?.setting.condition ?? null) !== null,
      condition: chosen?.setting.condition ?? null,
      reason: chosen?.setting.reason ?? null,
      hasDynamicReason: chosen?.setting.hasDynamicReason ?? false,
      isParallel: scope.mode === 'parallel',
      isSerial: scope.mode === 'serial',
      isShuffled: declaration.isShuffled,
      isParameterized: declaration.isParameterized,
      tags: unique(scope.details.tags),
      annotations: scope.details.annotations,
      locks: unique(scope.details.locks),
      meta: scope.details.meta,
      hooks: { ...scope.hooks },
      ...runKeys([scope.details.run]),
    };
  }

  private test(pending: PendingTest, suites: SuiteRecord[]): TestRecord {
    const { declaration } = pending;
    // A test from an imported helper is placed at the call in this file that registers it.
    const located = pending.site ?? pending.call;
    const scopes = outward(pending.scope);
    const describes = scopes.filter((scope) => scope.kind === 'describe').reverse();
    const title = declaration.title;
    const id = this.id([this.describeTitles(describes), title.withoutTags]);
    const chosen = chooseState([
      ...pending.states.map((setting) => ({ setting, source: 'test' as const })),
      ...scopes.flatMap((scope) =>
        scope.states.map((setting) => ({
          setting,
          source: scope.kind === 'file' ? ('file' as const) : ('suite' as const),
        })),
      ),
    ]);
    // When the runner refuses the file, no test in it runs, whatever else is written.
    const rejected = this.rejectedAt !== null;
    const state: TestState = rejected ? 'notLoaded' : (chosen?.setting.state ?? 'active');
    const setting = rejected ? null : (chosen?.setting ?? null);
    const suitePath = describes.flatMap((scope) => suiteOf(scope).declaration.title?.text ?? []);
    const fileScope = scopes[scopes.length - 1];
    const mode = declaration.mode ?? scopes.find((scope) => scope.mode !== null)?.mode ?? null;
    const meta: Record<string, MetaValue> = {};
    for (const values of [...describes.map((scope) => scope.details.meta), declaration.details.meta]) {
      Object.assign(meta, values);
    }
    const isOnly = declaration.isOnly || scopes.some((scope) => scope.isOnly);
    const comments =
      this.options.comments === 'all' || (this.options.comments === 'non-active' && state !== 'active')
        ? pending.comments
        : [];
    // `describe.each` and `describe.for` repeat every test inside them, as the test's own `.each` does.
    const tables = [declaration, ...describes.map((scope) => suiteOf(scope).declaration)].filter(
      (item) => item.isParameterized,
    );
    for (const item of pending.problems) this.diagnostics.push(this.diagnostic(item, id));
    if (declaration.usesBench && !this.options.isBenchmarkFile) {
      const message =
        'The test uses the bench fixture, which Vitest only provides in benchmark files such as *.bench.ts; elsewhere the test fails.';
      this.diagnostics.push(this.diagnostic(problem('bench-outside-benchmark-file', located, message), id));
    }
    if (declaration.isOnly) this.forbidOnly(located, pending.site ? null : pending.call);
    if (pending.isInLoop) {
      this.diagnostics.push(
        this.diagnostic(
          problem(
            'test-in-loop',
            located,
            'The test is declared in a loop; it is listed once, while the runner creates one test per iteration.',
          ),
          id,
        ),
      );
    }
    if (declaration.isOnly && chosen && chosen.source !== 'test' && chosen.setting.state === 'skip') {
      this.diagnostics.push(
        this.diagnostic(
          problem(
            'only-in-skipped-describe',
            located,
            'The test uses .only, but a describe around it is skipped, so it is skipped too.',
          ),
          id,
        ),
      );
    }
    const record: TestRecord = {
      id,
      bodyHash: declaration.hashed ? hashNodes([declaration.hashed]) : null,
      suiteId: describes.length > 0 ? (this.suiteIds.get(describes[describes.length - 1]) as string) : null,
      suitePath,
      relativeFilePath: this.options.relativeFilePath,
      fileName: this.fileName,
      ...this.position(located),
      declaredAt: this.declaredAt(pending.declaredAt),
      title: title.text,
      titleWithoutTags: title.withoutTags,
      hasDynamicTitle: title.isDynamic,
      fullName: [...suitePath, title.text].join(' > '),
      isTypeTest: this.options.isTypeTest,
      state,
      isActive: state === 'active',
      isSkipped: state === 'skip',
      isFixme: state === 'fixme',
      isTodo: state === 'todo',
      isExpectedToFail: state === 'expectedToFail',
      isNotLoaded: state === 'notLoaded',
      isOnly,
      isConditional: (setting?.condition ?? null) !== null,
      condition: setting?.condition ?? null,
      reason: setting?.reason ?? null,
      hasDynamicReason: setting?.hasDynamicReason ?? false,
      stateSource: rejected ? 'file' : (chosen?.source ?? null),
      stateLine: rejected ? this.rejectedAt : (setting?.line ?? null),
      isParallel: mode === 'parallel',
      isSerial: mode === 'serial',
      tags: unique([
        ...fileScope.details.tags,
        ...describes.flatMap((scope) => scope.details.tags),
        ...declaration.details.tags,
      ]),
      annotations: [...describes.flatMap((scope) => scope.details.annotations), ...pending.annotations],
      comments,
      locks: unique([
        ...fileScope.details.locks,
        ...describes.flatMap((scope) => scope.details.locks),
        ...declaration.details.locks,
      ]),
      meta: Object.keys(meta).length > 0 ? meta : null,
      hooks: addHooks(scopes),
      // Calls in the body and in `beforeEach` hooks run last, so they win over what the describes set.
      ...testRun([
        { run: pending.run, source: 'test' },
        ...scopes.map((scope) => ({ run: scope.hookRun, source: placeOf(scope) })),
        { run: declaration.details.run, source: 'test' },
        ...scopes.map((scope) => ({ run: scope.details.run, source: placeOf(scope) })),
      ]),
      fixtures: unique([...declaration.fixtures, ...[...scopes].reverse().flatMap((scope) => scope.hookFixtures)]),
      expectCount: pending.expectCount,
      expectedAssertions: pending.expectedAssertions,
      expectsAssertions: pending.expectsAssertions,
      hasEmptyBody: hasNoStatements(declaration.hashed),
      steps: pending.steps,
      isBenchmark: this.options.isBenchmarkFile || declaration.usesBench,
      isParameterized: tables.length > 0,
      caseCount: tables.length > 0 ? repetitions(tables.map((item) => item.caseCount)) : null,
      isInLoop: pending.isInLoop,
      isInCondition: pending.isInCondition,
      isInFunction: pending.isInFunction,
      projects: null,
    };
    const { projects, defaults } = this.options.config?.forTest(record, suites) ?? { projects: null, defaults: null };
    return {
      ...withConfig(record, defaults),
      isParallel: record.isParallel || (mode === null && defaults?.parallel === true),
      projects,
    };
  }

  /**
   * Tests with the same title. Playwright compares the whole title path in the file, without anonymous describes, and
   * refuses to load the file; Vitest allows duplicates, so they are only worth a warning there, within a describe.
   */
  private duplicates(pending: PendingTest[]): { index: number; problem: Problem }[] {
    const playwright = this.options.framework === 'playwright';
    const seen = new Map<Scope | null, Set<string>>();
    const found: { index: number; problem: Problem }[] = [];
    for (const [index, test] of pending.entries()) {
      if (test.declaration.title.isDynamic) continue;
      const describes = outward(test.scope).filter((scope) => scope.kind === 'describe');
      const titles = describes.flatMap((scope) => suiteOf(scope).declaration.title?.text ?? []).reverse();
      // In a loop, a title path that never changes is registered again on each pass.
      const repeated =
        playwright && test.isInLoop && describes.every((scope) => !suiteOf(scope).declaration.title?.isDynamic);
      if (repeated) {
        const message =
          'The test is declared in a loop with the same title on each pass, so Playwright fails to load the file and runs no tests at all.';
        const item = problem('duplicate-title', test.site ?? test.call, message, test.declaration.title.text);
        found.push({ index, problem: { ...item, level: 'error' } });
        continue;
      }
      const group = playwright ? null : test.scope;
      const key = JSON.stringify(playwright ? [...titles, test.declaration.title.text] : test.declaration.title.text);
      const keys = seen.get(group) ?? new Set<string>();
      seen.set(group, keys);
      if (keys.has(key)) {
        const message = playwright
          ? 'Another test in the file has the same title path, so Playwright fails to load the file and runs no tests at all.'
          : 'Another test in the same describe has the same title.';
        const item = problem('duplicate-title', test.site ?? test.call, message, test.declaration.title.text);
        found.push({ index, problem: playwright ? { ...item, level: 'error' } : item });
      }
      keys.add(key);
    }
    return found;
  }
}

/** An error for each id used by more than one record. Ordinals keep ids apart, so only a hash collision causes one. */
export function duplicateIdDiagnostics(records: readonly { id: string }[], relativeFilePath: string): Diagnostic[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of records) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].map((id) =>
    toDiagnostic(
      problem('duplicate-id', null, `Two records in the file have the id ${id}.`, id),
      relativeFilePath,
      null,
    ),
  );
}

export function buildRecords(extraction: Extraction, parsed: ParsedFile, options: RecordOptions): FileRecords {
  return new RecordBuilder(parsed, options).build(extraction);
}
