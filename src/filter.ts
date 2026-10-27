import { checkObject, OptionsError } from './options.ts';
import { summarize } from './summary.ts';
import type { Inventory, TestRecord, TestState } from './types.ts';

/** @inline */
export interface InventoryFilter {
  /** Keeps tests in one of these states. */
  states?: TestState[];
  /** Keeps tests with one of these tags, as the output writes them. */
  tags?: string[];
  /** Keeps tests whose `fullName` matches this regular expression, ignoring case, as Playwright's `--grep` does. */
  grep?: string;
  /** Keeps tests that use `.only`, or are inside a describe that does. */
  only?: boolean;
  /** Keeps tests that don't run and give no reason. Tests in a file the runner refuses are left out. */
  withoutReason?: boolean;
}

/** An inventory whose test records have only `id` and the keys picked with `pickTestFields()`. */
export type PickedInventory<K extends keyof TestRecord> = Omit<Inventory, 'tests'> & {
  tests: Pick<TestRecord, 'id' | K>[];
};

const STATES: readonly TestState[] = ['active', 'skip', 'fixme', 'todo', 'expectedToFail', 'notLoaded'];
const FILTER_KEYS: readonly string[] = [
  'states',
  'tags',
  'grep',
  'only',
  'withoutReason',
] satisfies (keyof InventoryFilter)[];

// Typed as a record of every key, so a key added to TestRecord fails to compile until it is listed here.
const TEST_KEYS = Object.keys({
  id: true,
  bodyHash: true,
  suiteId: true,
  suitePath: true,
  relativeFilePath: true,
  fileName: true,
  lineStart: true,
  lineEnd: true,
  columnStart: true,
  columnEnd: true,
  declaredAt: true,
  title: true,
  titleWithoutTags: true,
  hasDynamicTitle: true,
  fullName: true,
  isTypeTest: true,
  state: true,
  isActive: true,
  isSkipped: true,
  isFixme: true,
  isTodo: true,
  isExpectedToFail: true,
  isNotLoaded: true,
  isOnly: true,
  isConditional: true,
  condition: true,
  reason: true,
  hasDynamicReason: true,
  stateSource: true,
  stateLine: true,
  isParallel: true,
  isSerial: true,
  tags: true,
  annotations: true,
  comments: true,
  locks: true,
  meta: true,
  hooks: true,
  timeout: true,
  isSlow: true,
  slowCondition: true,
  retries: true,
  retryDelay: true,
  retryCondition: true,
  repeats: true,
  timeoutSource: true,
  retriesSource: true,
  repeatsSource: true,
  timeoutConfigText: true,
  retriesConfigText: true,
  repeatsConfigText: true,
  fixtures: true,
  expectCount: true,
  expectedAssertions: true,
  expectsAssertions: true,
  hasEmptyBody: true,
  steps: true,
  isBenchmark: true,
  isParameterized: true,
  caseCount: true,
  isInLoop: true,
  isInCondition: true,
  isInFunction: true,
  projects: true,
} satisfies Record<keyof TestRecord, true>);

function list(value: unknown, option: string, allowed: readonly string[] | null): string[] {
  if (value === undefined) return [];
  const valid = (item: unknown) =>
    typeof item === 'string' && item !== '' && (allowed === null || allowed.includes(item));
  if (Array.isArray(value) && value.every(valid)) return value as string[];
  const bad: unknown = Array.isArray(value) ? value.find((item) => !valid(item)) : value;
  const expected = allowed === null ? 'non-empty strings' : allowed.map((item) => `"${item}"`).join(', ');
  throw new OptionsError(`${option} can only hold ${expected}; got ${JSON.stringify(bad)}.`);
}

function flag(value: unknown, option: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new OptionsError(`${option} must be true or false.`);
  return value;
}

function pattern(value: unknown): RegExp | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value === '') throw new OptionsError('filter.grep must be a non-empty string.');
  try {
    return new RegExp(value, 'i');
  } catch (error) {
    throw new OptionsError(`filter.grep must be a regular expression: ${(error as Error).message}.`);
  }
}

/** Checks a filter and returns whether a test passes it. */
export function matcher(filter: InventoryFilter): (test: TestRecord) => boolean {
  const checked = checkObject(filter, 'filter');
  // A misspelled key would return every test, an answer that looks filtered but isn't.
  const unknown = Object.keys(checked).find((key) => !FILTER_KEYS.includes(key));
  if (unknown !== undefined) {
    throw new OptionsError(`filter can only have the keys ${FILTER_KEYS.join(', ')}; got "${unknown}".`);
  }
  const states = list(checked.states, 'filter.states', STATES);
  const tags = list(checked.tags, 'filter.tags', null);
  const grep = pattern(checked.grep);
  const only = flag(checked.only, 'filter.only');
  const withoutReason = flag(checked.withoutReason, 'filter.withoutReason');
  return (test) =>
    (states.length === 0 || states.includes(test.state)) &&
    (tags.length === 0 || test.tags.some((tag) => tags.includes(tag))) &&
    (grep === null || grep.test(test.fullName)) &&
    (!only || test.isOnly) &&
    (!withoutReason || (!test.isActive && !test.isNotLoaded && test.reason === null));
}

/**
 * Keeps the tests that pass every condition of the filter; a list keeps a test that has any of its values. The
 * result describes only those tests: their files, the describes around them, their diagnostics, and a summary
 * counted over them. Files without any tests stay, with their diagnostics, since tests may be missing from them.
 * `summary.fileCount` stays the number of files scanned.
 *
 * Throws a `TypeError` for an invalid filter.
 */
export function filterInventory(inventory: Inventory, filter: InventoryFilter): Inventory {
  const tests = inventory.tests.filter(matcher(filter));
  const testIds = new Set(tests.map((test) => test.id));
  const parents = new Map(inventory.suites.map((suite) => [suite.id, suite.parentId]));
  const suiteIds = new Set<string>();
  for (const test of tests) {
    for (let id = test.suiteId; id !== null && !suiteIds.has(id); id = parents.get(id) as string | null) {
      suiteIds.add(id);
    }
  }
  const suites = inventory.suites.filter((suite) => suiteIds.has(suite.id));
  const filesWithTests = new Set(inventory.tests.map((test) => test.relativeFilePath));
  const filesWithMatches = new Set(tests.map((test) => test.relativeFilePath));
  // A file, and a problem that is not about one test, stay unless every test of the file was left out: an error in
  // a file with no tests, or in package.json, may mean tests are missing from the answer.
  const keepsFile = (relativeFilePath: string) =>
    !filesWithTests.has(relativeFilePath) || filesWithMatches.has(relativeFilePath);
  const diagnostics = inventory.diagnostics.filter((diagnostic) =>
    diagnostic.testId === null ? keepsFile(diagnostic.relativeFilePath) : testIds.has(diagnostic.testId),
  );
  const summary = summarize(inventory.summary.fileCount, suites, tests, diagnostics);
  const files = inventory.files.filter((file) => keepsFile(file.relativeFilePath));
  return { ...inventory, summary, files, suites, tests, diagnostics };
}

/** Checks the keys to pick and returns them after `id`, each once. */
export function checkFields(fields: unknown): (keyof TestRecord)[] {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new OptionsError('fields must be a non-empty array of test record keys.');
  }
  const bad = fields.findIndex((field) => !TEST_KEYS.includes(field as string));
  if (bad !== -1) {
    throw new OptionsError(
      `fields can only hold keys of a test record, such as "fullName"; got ${JSON.stringify(fields[bad])}.`,
    );
  }
  return [...new Set(['id', ...(fields as (keyof TestRecord)[])])] as (keyof TestRecord)[];
}

/**
 * Leaves only `id` and the given keys on each test record, in that order, to make the output smaller. Suites,
 * diagnostics and the summary are unchanged. The result no longer matches the JSON Schema, which requires every key.
 *
 * Throws a `TypeError` for a key that test records don't have.
 */
export function pickTestFields<K extends keyof TestRecord>(
  inventory: Inventory,
  fields: readonly K[],
): PickedInventory<K> {
  const keys = checkFields(fields);
  const tests = inventory.tests.map(
    (test) => Object.fromEntries(keys.map((key) => [key, test[key]])) as Pick<TestRecord, 'id' | K>,
  );
  return { ...inventory, tests };
}
