/**
 * @asType integer
 * @minimum 0
 */
type Count = number;

/**
 * @asType integer
 * @minimum 1
 */
type Position = number;

/** @pattern ^[0-9a-f]{16}$ */
type Hash = string;

/** @inline */
export type Framework = 'playwright' | 'vitest';

/**
 * The state the runner applies to a test, after describes and file-level calls are taken into account. `notLoaded`:
 * the runner refuses to load the file, so none of its tests run.
 *
 * @inline
 */
export type TestState = 'active' | 'skip' | 'fixme' | 'todo' | 'expectedToFail' | 'notLoaded';

/**
 * Where a test's state is set: on the test, on a describe around it, or at file level.
 *
 * @inline
 */
export type StateSource = 'test' | 'suite' | 'file';

/**
 * `error`: tests may be missing from the output. `warning`: a value is missing or approximate.
 *
 * @inline
 */
export type DiagnosticLevel = 'error' | 'warning';

export type DiagnosticCode =
  | 'unresolved-test-import'
  | 'parse-error'
  | 'read-error'
  | 'framework-mismatch'
  | 'unresolved-tag'
  | 'unresolved-annotation'
  | 'unresolved-cases'
  | 'test-in-loop'
  | 'dynamic-title'
  | 'duplicate-title'
  | 'duplicate-id'
  | 'internal-error'
  | 'invalid-chain'
  | 'skip-without-body'
  | 'test-without-body'
  | 'describe-not-called'
  | 'async-describe'
  | 'nested-test'
  | 'tag-without-at'
  | 'removed-api'
  | 'only-in-skipped-describe'
  | 'config-may-change-state'
  | 'symlink-ignored'
  | 'invalid-import'
  | 'globals-not-enabled'
  | 'unknown-framework-version'
  | 'unsupported-framework-version'
  | 'local-test-object'
  | 'state-in-helper'
  | 'unresolved-option'
  | 'dynamic-reason'
  | 'no-files-matched'
  | 'unsupported-file'
  | 'approximate-framework-version'
  | 'test-in-function'
  | 'empty-title'
  | 'bench-outside-benchmark-file'
  | 'config-value-unknown'
  | 'file-not-run';

export type MetaValue = string | number | boolean | null | MetaValue[] | { [key: string]: MetaValue };

/** The output of one scan. */
export interface Inventory {
  /** Version of this format. It changes only when a key is removed, renamed or changes meaning. */
  schemaVersion: 1;
  tool: Tool;
  /** The framework the scan was run for. */
  framework: Framework;
  /** Read from the project, or given with `--framework-version`; null when unknown. */
  frameworkVersion: string | null;
  summary: Summary;
  /** The configs the scanned files use, sorted by path. */
  configs: ConfigRecord[];
  /** One per scanned file, in the order the files were scanned. */
  files: FileRecord[];
  suites: SuiteRecord[];
  tests: TestRecord[];
  diagnostics: Diagnostic[];
}

/**
 * One line of the JSON Lines output (`--format jsonl`): the inventory with each record on its own line, marked by
 * `type`. The `inventory` line comes first, then the configs, files, suites, tests and diagnostics in the order of the
 * JSON output, and the `summary` line last.
 */
export type InventoryLine =
  | ({ type: 'inventory' } & Pick<Inventory, 'schemaVersion' | 'tool' | 'framework' | 'frameworkVersion'>)
  | ({ type: 'config' } & ConfigRecord)
  | ({ type: 'file' } & FileRecord)
  | ({ type: 'suite' } & SuiteRecord)
  | ({ type: 'test' } & TestRecord)
  | ({ type: 'diagnostic' } & Diagnostic)
  | ({ type: 'summary' } & Summary);

/** @inline */
export interface Tool {
  name: 'test-inventory';
  /** Version of test-inventory that produced the output. */
  version: string;
}

/** Counts over the whole scan. Each test count uses the same definition as the matching test key. */
export interface Summary {
  /** Test files scanned. */
  fileCount: Count;
  suiteCount: Count;
  testCount: Count;
  activeCount: Count;
  skipCount: Count;
  fixmeCount: Count;
  todoCount: Count;
  expectedToFailCount: Count;
  notLoadedCount: Count;
  onlyCount: Count;
  conditionalCount: Count;
  parallelCount: Count;
  serialCount: Count;
  parameterizedCount: Count;
  inLoopCount: Count;
  inConditionCount: Count;
  inFunctionCount: Count;
  typeTestCount: Count;
  benchmarkCount: Count;
  diagnosticCount: Count;
  /** Tests per tag. */
  tagCounts: Record<string, Count>;
  /** Tests per annotation type. */
  annotationCounts: Record<string, Count>;
}

/**
 * A Playwright or Vitest config that scanned files use: the nearest one in a file's folder or a folder above it, up to
 * the root, as the runner started in that folder would. Read as code, never run.
 */
export interface ConfigRecord {
  /** Path from the project root, with `/` separators. */
  relativeFilePath: string;
  /** Files the config takes settings from through imports, such as a shared base config, in the order read. */
  extends: string[];
}

/** A scanned file, also one that has no tests or could not be read. */
export interface FileRecord {
  /** Path from the project root, with `/` separators. */
  relativeFilePath: string;
  fileName: string;
  /**
   * The config the file uses, from the project root: the outermost config at or above it that runs it, as the runner
   * started at the root would, else the nearest. Null when there is none.
   */
  config: string | null;
  /** Hooks at the top level of the file, which run around every test in it. */
  hooks: HookCounts;
  suiteCount: Count;
  testCount: Count;
}

/**
 * How many hooks of each kind are registered, including by helper functions called there.
 *
 * @inline
 */
export interface HookCounts {
  beforeAll: Count;
  beforeEach: Count;
  afterEach: Count;
  afterAll: Count;
  /** Vitest only. */
  aroundEach: Count;
  /** Vitest only. */
  aroundAll: Count;
}

/** A describe block, with what is written on the describe itself. Inherited values are on the tests. */
export interface SuiteRecord {
  id: Hash;
  /** The describe around this one; null at the top level. */
  parentId: Hash | null;
  /**
   * Hash of the describe's own code (hooks, `test.use()`, `describe.configure()`, helpers), ignoring whitespace,
   * comments, and nested tests and describes; null when nothing is left.
   */
  bodyHash: Hash | null;
  /** Path from the project root, with `/` separators. */
  relativeFilePath: string;
  fileName: string;
  lineStart: Position;
  lineEnd: Position;
  /** In UTF-16 code units. */
  columnStart: Position;
  /** In UTF-16 code units. */
  columnEnd: Position;
  /**
   * Where a helper imported from another file writes the describe; the record's location is then the
   * call that registers it. Null for code written in the scanned file.
   */
  declaredAt: DeclaredAt | null;
  /** As the runner shows it, tags included. */
  title: string;
  /** `title` with `@tag` words removed and spaces tidied. */
  titleWithoutTags: string;
  /** The title could not be resolved to a fixed string, so `title` holds its source text. */
  hasDynamicTitle: boolean;
  /** Titles of the describes around this one and of this one, outermost first. */
  path: string[];
  isSkipped: boolean;
  /** Playwright only. */
  isFixme: boolean;
  /** Vitest only. */
  isTodo: boolean;
  /** Tests in the describe are expected to fail, as with `test.fail()` in its body. Playwright only. */
  isExpectedToFail: boolean;
  isOnly: boolean;
  /** The state applies only when a condition holds. */
  isConditional: boolean;
  /** Source text of the condition, shortened when long; null when unconditional. */
  condition: string | null;
  reason: string | null;
  /** The reason could not be worked out to a string, so `reason` holds its source text. */
  hasDynamicReason: boolean;
  isParallel: boolean;
  /** Playwright only. */
  isSerial: boolean;
  /** Vitest only. */
  isShuffled: boolean;
  /** Declared with `.each` or `.for`. */
  isParameterized: boolean;
  tags: string[];
  annotations: Annotation[];
  /** Playwright only. */
  locks: string[];
  /** Vitest only; literal values only. */
  meta: Record<string, MetaValue> | null;
  /** Hooks registered directly in the describe. */
  hooks: HookCounts;
  /** In milliseconds; null when nothing here sets it. */
  timeout: Count | null;
  /** Playwright `test.slow()` written in the describe, which triples the timeout of its tests. */
  isSlow: boolean;
  /** Source text of the `test.slow()` condition; null when unconditional or not slow. */
  slowCondition: string | null;
  retries: Count | null;
  /** Vitest only: milliseconds between retries, from the `retry` object (4.1). */
  retryDelay: Count | null;
  /** Vitest only: source text of the `retry` object's `condition`, a RegExp or a function. */
  retryCondition: string | null;
  /** Vitest only: how many times the runner runs each test again after the first run. */
  repeats: Count | null;
}

/** A test, with the effective values the runner applies, including those inherited from its describes. */
export interface TestRecord {
  /** Derived from the file path, the describe titles, the title and its position among tests with the same title. */
  id: Hash;
  /** Hash of the test body, ignoring whitespace and comments; null when the test has no body. */
  bodyHash: Hash | null;
  /** The nearest describe; null outside any describe. */
  suiteId: Hash | null;
  /** Titles of the describes around the test, outermost first. */
  suitePath: string[];
  /** Path from the project root, with `/` separators. */
  relativeFilePath: string;
  fileName: string;
  lineStart: Position;
  lineEnd: Position;
  /** In UTF-16 code units. */
  columnStart: Position;
  /** In UTF-16 code units. */
  columnEnd: Position;
  /**
   * Where a helper imported from another file writes the test; the record's location is then the
   * call that registers it. Null for code written in the scanned file.
   */
  declaredAt: DeclaredAt | null;
  /** As the runner shows it, tags included. */
  title: string;
  /** `title` with `@tag` words removed and spaces tidied. */
  titleWithoutTags: string;
  /** The title could not be resolved to a fixed string, so `title` holds its source text. */
  hasDynamicTitle: boolean;
  /** `suitePath` and `title` joined with " > ". */
  fullName: string;
  /** Declared in a Vitest type test file (`*.test-d.ts`, `*.spec-d.ts`). */
  isTypeTest: boolean;
  state: TestState;
  isActive: boolean;
  isSkipped: boolean;
  isFixme: boolean;
  isTodo: boolean;
  isExpectedToFail: boolean;
  /** The runner refuses to load the file; a diagnostic at `stateLine` says why. */
  isNotLoaded: boolean;
  /** The test or a describe around it uses `.only`. */
  isOnly: boolean;
  /** The state applies only when a condition holds, as with `test.skip(condition)` or `skipIf`. */
  isConditional: boolean;
  /** Source text of the condition, shortened when long; null when unconditional. */
  condition: string | null;
  reason: string | null;
  /** The reason could not be worked out to a string, so `reason` holds its source text. */
  hasDynamicReason: boolean;
  /** null for active tests. */
  stateSource: StateSource | null;
  /** The line that sets the state; null for active tests. */
  stateLine: Position | null;
  /** Both `isParallel` and `isSerial` false means the framework's default mode. */
  isParallel: boolean;
  isSerial: boolean;
  /** From the test and every describe around it, outermost first, without duplicates. */
  tags: string[];
  annotations: Annotation[];
  /** Comment lines directly above the test. By default only filled for tests that are not active. */
  comments: string[];
  /** From the test, its describes and the `test.describe.configure()` calls around it. Playwright only. */
  locks: string[];
  /** Merged from the describes and the test. Vitest only; literal values only. */
  meta: Record<string, MetaValue> | null;
  /** Every hook that runs around the test: those of the file and of each describe around it. */
  hooks: HookCounts;
  /**
   * In milliseconds: the last `test.setTimeout()` in the body or a `beforeEach`, otherwise the nearest describe or file
   * that sets one. Null when the file sets none, so the config's timeout applies.
   */
  timeout: Count | null;
  /** Playwright `test.slow()` applies: the runner triples the timeout. */
  isSlow: boolean;
  /** Source text of the condition of the `test.slow()` that applies; null when unconditional or not slow. */
  slowCondition: string | null;
  /** How many times the runner retries the test when it fails; null when the file sets none. */
  retries: Count | null;
  /** Vitest only: milliseconds between retries, from the `retry` object (4.1). */
  retryDelay: Count | null;
  /** Vitest only: source text of the `retry` object's `condition`, a RegExp or a function. */
  retryCondition: string | null;
  /** Vitest only: how many times the runner runs the test again after the first run. */
  repeats: Count | null;
  /**
   * Names the test function takes from its context, then those of the `beforeEach`, `afterEach` and `aroundEach` hooks
   * around it, once each. Vitest's own context keys, such as `expect` and `task`, are left out.
   */
  fixtures: string[];
  /** Calls of `expect()`, `expect.soft()` and `expect.poll()` written in the body, each counted once. */
  expectCount: Count;
  /** Vitest `expect.assertions(n)` in the body. */
  expectedAssertions: Count | null;
  /** Vitest `expect.hasAssertions()` in the body. */
  expectsAssertions: boolean;
  /** The test function has no statements, comments aside. */
  hasEmptyBody: boolean;
  /** Playwright `test.step()` and `test.step.skip()` calls in the body, in source order. */
  steps: Step[];
  /** Vitest 5 benchmark: in a benchmark file, or using the `bench` fixture. Plain `vitest` doesn't run it. */
  isBenchmark: boolean;
  /** Declared with `.each` or `.for`, or inside a describe declared with them, so the runner repeats it. */
  isParameterized: boolean;
  /**
   * How many times the runner repeats the test: the cases of its own table times those of each describe table around
   * it. Null when a table is not written out in the file, or the test is not parameterized.
   */
  caseCount: Count | null;
  /** Declared inside a loop, `forEach` or `map`. */
  isInLoop: boolean;
  /** Declared inside `if`, `?:`, `&&`, `switch` or a `catch` block. */
  isInCondition: boolean;
  /** Declared inside a plain function. */
  isInFunction: boolean;
}

/** @inline */
export interface Step {
  /** The title, or its source text when it can't be worked out. */
  title: string;
  hasDynamicTitle: boolean;
  lineStart: Position;
  /** 0 for a step directly in the test, 1 for a step inside it, and so on. */
  depth: Count;
  /** Declared with `test.step.skip()`. */
  isSkipped: boolean;
}

/** @inline */
export interface DeclaredAt {
  /** The helper's file, from the project root. */
  relativeFilePath: string;
  lineStart: Position;
  /** In UTF-16 code units. */
  columnStart: Position;
}

/** @inline */
export interface Annotation {
  type: string;
  description: string | null;
  lineStart: Position;
}

export interface Diagnostic {
  code: DiagnosticCode;
  level: DiagnosticLevel;
  /** One sentence describing the problem. */
  message: string;
  relativeFilePath: string;
  /** null for problems with the whole file. */
  lineStart: Position | null;
  /** null for problems with the whole file. */
  columnStart: Position | null;
  /** The affected test; null when none. */
  testId: Hash | null;
  /** Source text involved, shortened when long; null when none. */
  source: string | null;
}
