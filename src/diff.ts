import { checkInventory } from './inventory-input.ts';
import { OptionsError } from './options.ts';
import type { Framework, Inventory, TestRecord, Tool } from './types.ts';
import { toolVersion } from './version.ts';

/** Changes a comparison can report; one matched test can have several. */
export type ChangeKind =
  | 'added'
  | 'removed'
  | 'moved'
  | 'renamed'
  | 'bodyChanged'
  | 'dependenciesChanged'
  | 'newlySkipped'
  | 'reEnabled'
  | 'stateChanged'
  | 'tagsChanged'
  | 'metadataChanged';

/** The evidence that two records identify the same test; null for an addition or removal. */
export type MatchMethod = 'id' | 'bodyHash' | 'bodyHashAndFile' | 'bodyHashAndSuite' | 'bodyHashAndDependencies';

/** One addition, removal or changed test. Locations and records come from the saved scans unchanged. */
export type TestChange = {
  kinds: ChangeKind[];
  /** Changed record keys, excluding locations and ids. Hashes are included only when comparable. */
  changedFields: (keyof TestRecord)[];
} & (
  | { match: MatchMethod; before: TestRecord; after: TestRecord }
  | { match: null; before: TestRecord; after: null }
  | { match: null; before: null; after: TestRecord }
);

/** Tests with identical syntax-tree bodies, including trivial bodies; this does not prove they test the same thing. */
export interface CloneGroup {
  bodyHash: string;
  testIds: string[];
}

/** The deterministic comparison of two saved inventories. */
export interface InventoryDiff {
  schemaVersion: 1;
  tool: Tool;
  framework: Framework;
  beforeToolVersion: string;
  afterToolVersion: string;
  hashesComparable: boolean;
  /** Category counts overlap; changed counts matched tests, while unchanged counts matches with no changes. */
  summary: Record<ChangeKind | 'changed' | 'unchanged', number>;
  changes: TestChange[];
  clones: { before: CloneGroup[]; after: CloneGroup[] };
  warnings: string[];
}

const KINDS: ChangeKind[] = [
  'added',
  'removed',
  'moved',
  'renamed',
  'bodyChanged',
  'dependenciesChanged',
  'newlySkipped',
  'reEnabled',
  'stateChanged',
  'tagsChanged',
  'metadataChanged',
];
const LOCATION = new Set([
  'id',
  'lineStart',
  'lineEnd',
  'columnStart',
  'columnEnd',
  'declaredAt',
  'stateLine',
  'suiteId',
  'parentTestId',
  'fileName',
]);
const CLASSIFIED = new Set([
  'relativeFilePath',
  'title',
  'titleWithoutTags',
  'fullName',
  'suitePath',
  'bodyHash',
  'dependencyHash',
  'state',
  'tags',
  'isActive',
  'isSkipped',
  'isFixme',
  'isTodo',
  'isExpectedToFail',
  'isNotLoaded',
]);

/** Stable object-key order makes saved JSON comparisons independent of how a client serialized objects. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)));
  });
}

function groups(tests: Iterable<TestRecord>, keyOf: (test: TestRecord) => string | null): Map<string, TestRecord[]> {
  const found = new Map<string, TestRecord[]>();
  for (const test of tests) {
    const key = keyOf(test);
    if (key === null) continue;
    const group = found.get(key) ?? [];
    group.push(test);
    found.set(key, group);
  }
  return found;
}

function clones(inventory: Inventory): CloneGroup[] {
  return [...groups(inventory.tests, (test) => test.bodyHash)]
    .filter(([, tests]) => tests.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bodyHash, tests]) => ({ bodyHash, testIds: tests.map((test) => test.id).sort() }));
}

function changed(before: TestRecord, after: TestRecord, hashesComparable: boolean): (keyof TestRecord)[] {
  return ([...new Set([...Object.keys(before), ...Object.keys(after)])] as (keyof TestRecord)[])
    .filter((key) => {
      if (LOCATION.has(key) || (!hashesComparable && ['bodyHash', 'dependencyHash'].includes(key))) return false;
      if (key === 'tags') return stable([...before.tags].sort()) !== stable([...after.tags].sort());
      return stable(before[key]) !== stable(after[key]);
    })
    .sort();
}

function kindsOf(before: TestRecord, after: TestRecord, fields: (keyof TestRecord)[]): ChangeKind[] {
  const kinds: ChangeKind[] = [];
  if (fields.includes('relativeFilePath')) kinds.push('moved');
  if (before.title !== after.title || stable(before.suitePath) !== stable(after.suitePath)) kinds.push('renamed');
  if (fields.includes('bodyHash')) kinds.push('bodyChanged');
  if (fields.includes('dependencyHash')) kinds.push('dependenciesChanged');
  const disabled = (test: TestRecord) => ['skip', 'fixme', 'todo'].includes(test.state);
  const runnable = (test: TestRecord) => ['active', 'expectedToFail'].includes(test.state);
  if (runnable(before) && disabled(after)) kinds.push('newlySkipped');
  if (disabled(before) && runnable(after)) kinds.push('reEnabled');
  if (fields.includes('state')) kinds.push('stateChanged');
  if (fields.includes('tags')) kinds.push('tagsChanged');
  if (fields.some((field) => !CLASSIFIED.has(field))) kinds.push('metadataChanged');
  return kinds;
}

/**
 * Compares complete inventories without mutating them. Match ids first, then mutually unique body hashes, narrowing
 * ambiguous hashes by file, suite and dependencies. Remaining ambiguities stay additions and removals. Hashes from
 * different tool versions are not compared; scan both revisions with one version for rename and body detection.
 */
export function diffInventories(before: Inventory, after: Inventory): InventoryDiff {
  checkInventory(before, 'before');
  checkInventory(after, 'after');
  if (before.framework !== after.framework)
    throw new OptionsError(
      'before and after must use the same framework. Scan both revisions with the same --framework.',
    );
  const hashesComparable = before.tool.version === after.tool.version;
  const left = new Set(before.tests);
  const right = new Set(after.tests);
  const pairs: { before: TestRecord; after: TestRecord; match: MatchMethod }[] = [];
  const pair = (method: MatchMethod, keyOf: (test: TestRecord) => string | null) => {
    const old = groups(left, keyOf);
    const next = groups(right, keyOf);
    for (const [key, tests] of old) {
      const other = next.get(key);
      if (tests.length !== 1 || other?.length !== 1) continue;
      pairs.push({ before: tests[0], after: other[0], match: method });
      left.delete(tests[0]);
      right.delete(other[0]);
    }
  };
  pair('id', (test) => test.id);
  if (hashesComparable) {
    pair('bodyHash', (test) => test.bodyHash);
    const withHash = (test: TestRecord, keys: unknown[]) =>
      test.bodyHash === null ? null : stable([test.bodyHash, ...keys]);
    pair('bodyHashAndFile', (test) => withHash(test, [test.relativeFilePath]));
    pair('bodyHashAndSuite', (test) => withHash(test, [test.relativeFilePath, test.suitePath]));
    pair('bodyHashAndDependencies', (test) =>
      withHash(test, [test.dependencies.filter((file) => file !== test.relativeFilePath)]),
    );
  }
  const summary = Object.fromEntries(
    [...KINDS, 'changed', 'unchanged'].map((kind) => [kind, 0]),
  ) as InventoryDiff['summary'];
  const changes: TestChange[] = [];
  for (const { before, after, match } of pairs) {
    const changedFields = changed(before, after, hashesComparable);
    const kinds = kindsOf(before, after, changedFields);
    if (kinds.length === 0) summary.unchanged++;
    else {
      summary.changed++;
      changes.push({ kinds, match, before, after, changedFields });
    }
  }
  for (const test of left)
    changes.push({ kinds: ['removed'], match: null, before: test, after: null, changedFields: [] });
  for (const test of right)
    changes.push({ kinds: ['added'], match: null, before: null, after: test, changedFields: [] });
  for (const change of changes) for (const kind of change.kinds) summary[kind]++;
  changes.sort((a, b) => {
    const key = (change: TestChange) => {
      const test = change.after ?? change.before;
      return stable([test.relativeFilePath, test.fullName, test.id, change.kinds]);
    };
    return key(a) < key(b) ? -1 : 1;
  });
  return {
    schemaVersion: 1,
    tool: { name: 'test-inventory', version: toolVersion },
    framework: before.framework,
    beforeToolVersion: before.tool.version,
    afterToolVersion: after.tool.version,
    hashesComparable,
    summary,
    changes,
    clones: { before: clones(before), after: clones(after) },
    warnings: [
      ...(!hashesComparable
        ? [
            'Tool versions differ: hash comparisons and rename matching are disabled. Scan both revisions with one test-inventory version.',
          ]
        : []),
      ...([before, after].some((inventory) => inventory.diagnostics.some((diagnostic) => diagnostic.level === 'error'))
        ? ['At least one scan has errors; missing tests may appear as additions or removals. Check its diagnostics.']
        : []),
    ],
  };
}
