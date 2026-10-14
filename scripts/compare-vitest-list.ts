// Compares the tests Vitest's static parser lists, as `scripts/list-vitest-tests.ts` prints them, with an inventory of
// the same files. Each difference gets the known cause that explains it, or none. Vitest's list is a second opinion,
// not the truth: its parser has bugs of its own, and some of the causes below are those.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CallExpression, Expression, Node } from 'oxc-parser';
import { childNodes, isFunctionNode, unwrap } from '../src/ast.ts';
import { exportName } from '../src/frameworks/bindings.ts';
import type { Inventory, SuiteRecord, TestRecord } from '../src/index.ts';
import { parseFile } from '../src/parse.ts';
import { SourceText } from '../src/source.ts';

export interface ListedModule {
  file: string;
  /** Why Vitest could not read the file, as when it refuses a `vi.mock` call below the top level. */
  errors: string[];
  tests: ListedTest[];
}

export interface ListedTest {
  name: string;
  /** 0 when Vitest has no location, as for a table written as a tagged template. */
  line: number;
  column: number;
  mode: 'run' | 'skip' | 'only' | 'todo';
}

export interface Difference {
  /** `file:line` */
  at: string;
  detail: string;
  /** The known cause that explains it; null when none does, which needs a look. */
  cause: string | null;
}

/** What makes the list and the inventory differ where both are right, or where Vitest's parser reads code wrongly. */
const CAUSES = {
  notATest:
    "Vitest lists a call with no title and function, as `testRouting('NYSE')`, by a name that starts with 'test'",
  inTestBody: 'Vitest lists a call inside a test body, where the runner never collects tests',
  onlyAcrossFiles: "Vitest's parser applies `.only` in one file to every file; a run applies it within the file",
  onlyInFile:
    'Another test in the file uses `.only`, so the runner skips this one if allowed; the scan keeps its state',
  escapes: 'Vitest keeps the escapes in a name as they are written, as in `\\"`',
  chainedAfterCall: 'Vitest drops a test or describe chained after a call, as in `describe.runIf(hasBroker).skip(...)`',
  describeMode: "Vitest's parser gives a test its describe's mode in place of its own `skip` or `todo`",
  sourceText: 'Vitest names a test by the source text of a title the scan works out, as in `OrderBook.name`',
  helperTitle:
    'Vitest names a test in a helper function where it is written; the scan, like the runner, where it is called',
  vitestName: "Vitest finds test objects by name: `test`, `it`, `describe`, `suite`, or a name like 'testX' or 'xTest'",
  importedHelper: 'The test is written in an imported helper, and Vitest reads each file on its own',
  fileError: 'Both say the runner refuses the file',
  refusedFile:
    "The scan says the runner refuses the file, for code Vitest's parser doesn't check: `test.sequential` in Vitest 5",
  conditional: 'A condition decides the state at run time; Vitest reads `skipIf` and `runIf` as skip',
  dynamicTitle: 'The title is worked out at run time',
  missingTests: 'The scan reports an `unresolved-test-import` error: tests that use the import are missing',
};

/** The state a record has, as Vitest's modes name it. */
function modeOf(test: TestRecord): ListedTest['mode'] {
  if (test.isTodo) return 'todo';
  return test.isActive || test.isExpectedToFail ? 'run' : 'skip';
}

/** Undoes the escapes of a JavaScript string, for a name Vitest gives as written in the code. */
function unescape(text: string): string {
  return text.replace(/\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|([\s\S]))/gi, (_, braced, u4, x2, other) => {
    const code = (braced ?? u4 ?? x2) as string | undefined;
    if (code) return String.fromCodePoint(parseInt(code, 16));
    const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
    return escapes[other as string] ?? (other as string);
  });
}

/** Whether Vitest's parser takes a call through this name for a test or describe. */
function isVitestName(name: string): boolean {
  return ['it', 'test', 'describe', 'suite'].includes(name) || name.startsWith('test') || name.endsWith('Test');
}

/**
 * Where Vitest places a call: where it starts, or after its callee when the callee is a call itself, as in
 * `test.each(cases)(...)` and `onNode(22)(...)`.
 */
function listedAt(call: CallExpression): number {
  const callee = unwrap(call.callee);
  const afterCallee =
    callee.type === 'CallExpression' ||
    callee.type === 'SequenceExpression' ||
    callee.type === 'TaggedTemplateExpression';
  return afterCallee ? callee.end : call.start;
}

/** The calls in a file, by where they start and by where Vitest places them, outermost first. */
class FileCode {
  private readonly starts = new Map<string, CallExpression[]>();
  private readonly listed = new Map<string, CallExpression[]>();
  /** Vitest reads the file after Vite's transform, which turns an imported name into the name the module exports. */
  readonly imported = new Map<string, string>();

  constructor(root: string, file: string) {
    const text = readFileSync(path.join(root, file), 'utf8');
    const source = new SourceText(text);
    const { program } = parseFile(file, text);
    const add = (calls: Map<string, CallExpression[]>, offset: number, call: CallExpression) => {
      const { line, column } = source.position(offset);
      calls.set(`${line}:${column}`, [...(calls.get(`${line}:${column}`) ?? []), call]);
    };
    const visit = (node: Node) => {
      if (node.type === 'CallExpression') {
        add(this.starts, node.start, node);
        add(this.listed, listedAt(node), node);
      }
      if (node.type === 'ImportSpecifier') this.imported.set(node.local.name, exportName(node.imported));
      for (const child of childNodes(node)) visit(child);
    };
    visit(program);
  }

  /** The calls Vitest places at a position. */
  listedAt(line: number, column: number): CallExpression[] {
    return this.listed.get(`${line}:${column}`) ?? [];
  }

  /** The outermost call at a record's position: `describe.runIf(c).skip(...)` rather than `describe.runIf(c)`. */
  of(record: { lineStart: number; columnStart: number }): CallExpression | null {
    return this.starts.get(`${record.lineStart}:${record.columnStart}`)?.[0] ?? null;
  }
}

/** The name a call chain starts from: `describe` in `describe.each(table)(...)`, `onNode` in `onNode(22)(...)`. */
function chainName(expression: Expression): string | null {
  const node = unwrap(expression);
  switch (node.type) {
    case 'Identifier':
      return node.name;
    case 'MemberExpression':
      return chainName(node.object);
    case 'CallExpression':
      return chainName(node.callee);
    case 'TaggedTemplateExpression':
      return chainName(node.tag);
    default:
      return null;
  }
}

/** `x(...).y(...)`, which Vitest skips as it skips `test('name', fn).skip()`. */
function isChainedAfterCall(call: CallExpression | null): boolean {
  const callee = call ? unwrap(call.callee) : null;
  return callee?.type === 'MemberExpression' && unwrap(callee.object).type === 'CallExpression';
}

/** A title followed by a function, as a test or describe declaration passes them. */
function passesTitleAndFunction(call: CallExpression): boolean {
  const [first, ...rest] = call.arguments;
  return rest.some((arg) => isFunctionNode(arg)) && !isFunctionNode(first);
}

/** A title written as a string or as a template without expressions, which Vitest takes as it is. */
function isPlainTitle(call: CallExpression | null): boolean {
  const first = call?.arguments[0];
  if (first?.type === 'Literal') return typeof first.value === 'string';
  return first?.type === 'TemplateLiteral' && first.expressions.length === 0;
}

export function compareWithVitest(root: string, inventory: Inventory, modules: ListedModule[]): Difference[] {
  const listed = new Map(modules.map((module) => [module.file, module]));
  const suites = new Map(inventory.suites.map((suite) => [suite.id, suite]));
  const code = new Map<string, FileCode>();
  const codeOf = (file: string) => {
    let found = code.get(file);
    if (!found) {
      found = new FileCode(root, file);
      code.set(file, found);
    }
    return found;
  };
  const describesOf = (test: TestRecord): SuiteRecord[] => {
    const around: SuiteRecord[] = [];
    for (let suite = suites.get(test.suiteId ?? ''); suite; suite = suites.get(suite.parentId ?? '')) {
      around.unshift(suite);
    }
    return around;
  };
  const filesWithOnly = new Set(inventory.tests.filter((test) => test.isOnly).map((test) => test.relativeFilePath));
  const where = (codes: string[], place: (file: string, line: number | null) => string) =>
    new Set(
      inventory.diagnostics
        .filter((diagnostic) => codes.includes(diagnostic.code))
        .map((diagnostic) => place(diagnostic.relativeFilePath, diagnostic.lineStart)),
    );
  const unresolvedImports = where(['unresolved-test-import'], (file) => file);
  // The calls that make the runner refuse the file, by line.
  const refusedCalls = where(['invalid-chain', 'removed-api'], (file, line) => `${file}:${line}`);
  const differences: Difference[] = [];
  const matched = new Set<ListedTest>();

  // Records at one place come from a helper called several times; Vitest lists the place once.
  const places = new Map<string, TestRecord[]>();
  for (const test of inventory.tests) {
    const key = `${test.relativeFilePath}:${test.lineStart}:${test.columnStart}`;
    places.set(key, [...(places.get(key) ?? []), test]);
  }

  for (const records of places.values()) {
    const [first] = records;
    const file = first.relativeFilePath;
    const at = `${file}:${first.lineStart}`;
    const module = listed.get(file);
    const entry = module ? matchOf(first, module.tests) : undefined;
    if (!entry) {
      for (const test of records) {
        differences.push({ at, detail: `${test.fullName} (${test.state}): not in Vitest's list`, cause: missed(test) });
      }
      continue;
    }
    matched.add(entry);
    if (records.length > 1 && !records.every((test) => test.isInFunction)) {
      differences.push({ at, detail: `${records.length} records, one in Vitest's list`, cause: null });
    }
    for (const test of records) {
      if (modeOf(test) !== entry.mode) {
        const detail = `${test.fullName}: ${test.state} / ${entry.mode}`;
        differences.push({ at, detail, cause: stateCause(test, entry) });
      }
      if (entry.name !== test.fullName) {
        differences.push({ at, detail: `${test.fullName} / ${entry.name}`, cause: nameCause(test, entry) });
      }
    }
  }

  for (const module of modules) {
    for (const entry of module.tests.filter((item) => !matched.has(item))) {
      const at = `${module.file}:${entry.line}`;
      differences.push({ at, detail: `${entry.name}: not in the inventory`, cause: extra(module.file, entry) });
    }
  }
  return differences;

  /**
   * The test Vitest lists for a record: in its lines, with its name or where Vitest places its call, since Vitest also
   * lists `onNode(22)` in `onNode(22)('reads the order book', fn)`; by name alone when Vitest has no location.
   */
  function matchOf(test: TestRecord, tests: ListedTest[]): ListedTest | undefined {
    const named = (item: ListedTest) => item.name === test.fullName || unescape(item.name) === test.fullName;
    const inRange = tests.filter((item) => item.line >= test.lineStart && item.line <= test.lineEnd);
    const file = codeOf(test.relativeFilePath);
    const call = file.of(test);
    const placed = (item: ListedTest) => call !== null && file.listedAt(item.line, item.column).includes(call);
    return (
      inRange.find(named) ??
      inRange.find(placed) ??
      inRange.find((item) => item.line === test.lineStart) ??
      inRange.at(0) ??
      tests.find((item) => item.line === 0 && !matched.has(item) && named(item))
    );
  }

  /** Why a record has no test in Vitest's list. */
  function missed(test: TestRecord): string | null {
    const module = listed.get(test.relativeFilePath);
    if (module && module.errors.length > 0 && test.isNotLoaded) return CAUSES.fileError;
    if (test.declaredAt) return CAUSES.importedHelper;
    const call = codeOf(test.relativeFilePath).of(test);
    if (isChainedAfterCall(call)) return CAUSES.chainedAfterCall;
    const name = call ? chainName(call.callee) : null;
    if (name !== null && !isVitestName(codeOf(test.relativeFilePath).imported.get(name) ?? name)) {
      return CAUSES.vitestName;
    }
    return null;
  }

  /** Whether a describe around the test is chained after a call, so that Vitest drops it. */
  function inDroppedDescribe(test: TestRecord): boolean {
    return describesOf(test).some((suite) => isChainedAfterCall(codeOf(suite.relativeFilePath).of(suite)));
  }

  function stateCause(test: TestRecord, entry: ListedTest): string | null {
    // Vitest lists nothing in a file it can't read, so this is one it reads and the runner refuses.
    if (test.isNotLoaded) return CAUSES.refusedFile;
    if (test.isConditional) return CAUSES.conditional;
    if (entry.mode === 'skip' && !test.isOnly && filesWithOnly.size > 0) {
      return filesWithOnly.has(test.relativeFilePath) ? CAUSES.onlyInFile : CAUSES.onlyAcrossFiles;
    }
    if (inDroppedDescribe(test)) return CAUSES.chainedAfterCall;
    const describeMode = describesOf(test).some((suite) => suite.isOnly || suite.isSkipped || suite.isTodo);
    return test.stateSource === 'test' && describeMode ? CAUSES.describeMode : null;
  }

  function nameCause(test: TestRecord, entry: ListedTest): string | null {
    if (unescape(entry.name) === test.fullName) return CAUSES.escapes;
    if (test.isInFunction) return CAUSES.helperTitle;
    const titled = [...describesOf(test), test];
    if (titled.some((item) => item.hasDynamicTitle)) return CAUSES.dynamicTitle;
    if (inDroppedDescribe(test)) return CAUSES.chainedAfterCall;
    if (titled.some((item) => !isPlainTitle(codeOf(item.relativeFilePath).of(item)))) return CAUSES.sourceText;
    return null;
  }

  /** Why Vitest lists a test the inventory doesn't have. */
  function extra(file: string, entry: ListedTest): string | null {
    const records = inventory.tests.filter((test) => test.relativeFilePath === file);
    if (records.some((test) => entry.line > test.lineStart && entry.line <= test.lineEnd)) return CAUSES.inTestBody;
    if (unresolvedImports.has(file)) return CAUSES.missingTests;
    if (refusedCalls.has(`${file}:${entry.line}`)) return CAUSES.refusedFile;
    const calls = codeOf(file).listedAt(entry.line, entry.column);
    return calls.length > 0 && !calls.some(passesTitleAndFunction) ? CAUSES.notATest : null;
  }
}
