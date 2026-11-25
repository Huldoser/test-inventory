import { isBuiltin } from 'node:module';
import { visitorKeys } from 'oxc-parser';
import type {
  CallExpression,
  CatchClause,
  Expression,
  ImportDeclaration,
  ImportDeclarationSpecifier,
  Node,
  Program,
  VariableDeclarator,
} from 'oxc-parser';
import {
  childNodes,
  isFunctionNode,
  isImportMetaVitest,
  isReference,
  propertyName,
  returnValues,
  unwrap,
  type FunctionNode,
} from './ast.ts';
import { commonJsExport, exportName, requiredModule } from './frameworks/bindings.ts';
import { problem, readCount } from './frameworks/common.ts';
import type {
  Adapter,
  ApiCall,
  Details,
  Mode,
  ModuleReader,
  ModuleSource,
  Problem,
  Returns,
  RunSettings,
  Span,
  StateSetting,
  SuiteDeclaration,
  TestDeclaration,
} from './model.ts';
import type { ParsedFile } from './parse.ts';
import { snippet, splitLines, type SourceText } from './source.ts';
import type { Annotation, HookCounts, Step } from './types.ts';
import {
  bindingNames,
  isScopeNode,
  nonIterable,
  type ParameterStep,
  type Resolved,
  type Value,
  type Values,
} from './values.ts';

/** The file or a describe, with what is set on it. Tests inherit from every scope around them. */
export interface Scope {
  kind: 'file' | 'describe';
  parent: Scope | null;
  states: StateSetting[];
  mode: Mode | null;
  isOnly: boolean;
  details: Details;
  /** Hooks registered directly in the scope. */
  hooks: HookCounts;
  /** Run settings from `beforeEach` hooks in the scope, which run before each test in it and win over the scope's own. */
  hookRun: RunSettings;
  /** Fixtures of the hooks in the scope that run around each test. */
  hookFixtures: string[];
  /** Fixtures of every hook in the scope, `beforeAll` and `afterAll` too, which set up what its tests run. */
  setupFixtures: string[];
  /** A hook in the scope takes its fixtures whole, so it may use any. */
  takesAllFixtures: boolean;
  suite: PendingSuite | null;
}

/** Where a test or describe registered through an imported helper is written, in the helper's module. */
export interface DeclaredAt {
  relativeFilePath: string;
  source: SourceText;
  start: number;
}

export interface PendingSuite {
  scope: Scope;
  declaration: SuiteDeclaration;
  call: CallExpression;
  /** For a describe declared in an imported helper, the call in the scanned file that registers it; null otherwise. */
  site: Span | null;
  declaredAt: DeclaredAt | null;
  /** The file the describe is written in. */
  frame: Frame;
  /** The outermost helper call in the scanned file that declares the describe; null when the file declares it. */
  registeredBy: Node | null;
  /** Where the scanned file registers the describe: its own call, or the outermost helper call that declares it. */
  order: number;
  /** Statements of the tests and describes directly inside, left out of the describe's body hash. */
  cuts: Span[];
  /** Declared under a condition, or in a function: it may not run while the file loads. */
  isInCondition: boolean;
  isInFunction: boolean;
  /** With `expandCases`, the index of the case of a table or pass of a loop this describe is; null otherwise. */
  caseIndex: number | null;
}

export interface PendingTest {
  /** Line where collection stopped before this spec could register in its suite. */
  registrationStoppedAt?: number;
  scope: Scope;
  /** The test whose body declares this one as a subtest; null for a test declared in the file or a describe. */
  parent: PendingTest | null;
  declaration: TestDeclaration;
  call: CallExpression;
  /** For a test declared in an imported helper, the call in the scanned file that registers it; null otherwise. */
  site: Span | null;
  declaredAt: DeclaredAt | null;
  /** The file the test is written in. */
  frame: Frame;
  /** The outermost helper call in the scanned file that declares the test; null when the file declares it. */
  registeredBy: Node | null;
  /** Where the scanned file registers the test: its own call, or the outermost helper call that declares it. */
  order: number;
  /** States from the declaration, then from calls in the body such as `test.skip(condition)`. */
  states: StateSetting[];
  annotations: Annotation[];
  isInLoop: boolean;
  /**
   * How many times each loop around the test registers it, outermost first; null for a loop the scan can't count, or
   * one that registers it under a condition.
   */
  loops: (number | null)[];
  /** How many passes each loop around the test makes, whether or not it registers the test on each. */
  passes: (number | null)[];
  isInCondition: boolean;
  isInFunction: boolean;
  /** With `expandCases`, the index of the case of a table or pass of a loop this test is; null otherwise. */
  caseIndex: number | null;
  comments: string[];
  /** Run settings from calls in the body, which win over everything around the test. */
  run: RunSettings;
  expectCount: number;
  expectedAssertions: number | null;
  expectsAssertions: boolean;
  steps: Step[];
  problems: Problem[];
}

/** A file the walk reads code from: the scanned file, or a module a helper function is imported from. */
export interface Frame {
  parsed: ParsedFile;
  adapter: Adapter;
  values: Values;
  readModule: ModuleReader | null;
  relativeFilePath: string;
}

/** How the walk lists tables and loops. */
export interface ExtractOptions {
  /** Follow modules loaded while a Playwright spec registers its tests. */
  collectImports?: boolean;
  /** Whether this local import still needs to run in the collecting Playwright process. */
  initializeModule?: (file: string) => boolean;
  /** One test or describe per case of a table and per pass of a loop whose values the scan can work out. */
  expandCases: boolean;
  /** Vitest's `[major, minor]`, whose rules give each case its title; null for the newest rules. */
  version: readonly [number, number] | null;
}

/** Reads a module a helper is imported from as a frame; null when it can't be parsed. */
export type OpenModule = (module: ModuleSource) => Frame | null;

/** A function walked at a call, and the file it is written in. */
interface Callee {
  fn: FunctionNode;
  frame: Frame;
}

export interface Extraction {
  /** Line where an uncaught exception stopped Jasmine loading this spec file. */
  registrationStoppedAt?: number;
  unknownRegistration: boolean;
  suites: PendingSuite[];
  tests: PendingTest[];
  /** Problems not tied to one test. */
  problems: Problem[];
  /** Hooks at the top level of the file. */
  hooks: HookCounts;
  usesGlobals: boolean;
  /** The file's `@module-tag` tags, where each is written. */
  fileTags: { name: string; span: Span }[];
}

interface AsyncRegistration {
  body: Node;
  atAwait?: { scope?: Scope };
  pending?: boolean;
}

interface Registration {
  stoppedAt?: number;
  /** The suite an async helper leaves current when it gives control back to the caller. */
  asyncCall?: AsyncRegistration;
  /** Current suite after user code caught an empty-suite error. */
  scope?: Scope;
  /** Suite Jasmine left current as a registration error escaped. */
  recoveryScope?: Scope;
}

function possibleRegistration(registration: Registration | undefined): Registration | undefined {
  return registration && { ...registration, asyncCall: registration.asyncCall && { ...registration.asyncCall } };
}

interface Context {
  /** Evaluating an argument to a runner API at collection time, before the runner receives it. */
  evaluatingArgument?: boolean;
  parameterSteps?: ReadonlyMap<Node, ParameterStep>;
  /** Shared by synchronous helper calls, copied for paths that might not run and for nested suites. */
  registration?: Registration;
  emptySuiteAt?: number;
  handlesRegistrationError?: boolean;
  /** Direct declarations are inventoried under guards even where an import cannot execute. */
  skipImports?: boolean;
  scope: Scope;
  test: PendingTest | null;
  /** The scope a hook body applies to, while in a hook. */
  hookScope: Scope | null;
  hookName: keyof HookCounts | null;
  /** How many `test.step()` callbacks the walk is in. */
  stepDepth: number;
  /** The framework's names for the current test or hook context, such as Vitest's `context.skip`. */
  testContext: unknown;
  /** Source text of the conditions around a call (`if`, `?:`, logical operators, `switch`) within the current body. */
  guards: string[];
  isInLoop: boolean;
  /** How many passes each loop around the call makes, outermost first; null for a loop the scan can't count. */
  loops: (number | null)[];
  /**
   * For each of `loops`, whether a condition inside it leaves the count as it is: one was already around where the
   * loop starts, or the loop is expanded, so each pass is its own record.
   */
  loopConditions: boolean[];
  /** The pass of the innermost expanded loop the walk is in, for the next test or describe; null outside one. */
  caseIndex: number | null;
  /** In a pass of an expanded loop or a case of an expanded describe table. */
  isExpanding: boolean;
  /**
   * Where the outermost expanded loop or describe table the walk is in starts; null outside one. What it registers is
   * ordered there, as the runner registers it, pass after pass.
   */
  expandedAt: number | null;
  isInCondition: boolean;
  isInFunction: boolean;
  /** The plain function being walked outside any test or hook, whose states apply to the code that calls it. */
  helper: Node | null;
  /** The innermost function with a name being walked outside any test or hook; calling it registers its tests. */
  declaredIn: Node | null;
  /**
   * While an imported helper is walked at a call in a function with a name walked where it is written: that function
   * and the call. The tests the helper registers are listed at the call, and only a call of that function registers them.
   */
  calledIn: { fn: Node; call: CallExpression } | null;
  /**
   * Set while a function is walked where it is written although it is also walked at its calls: only the states it sets
   * are collected, for calls from tests and hooks, and its tests and describes are not recorded again.
   */
  quiet: boolean;
  /** The outermost helper call being walked from the file or a describe; null outside one. */
  registeredBy: Node | null;
}

/** A function with a name, waiting to be walked where it is written once the calls in the file are known. */
interface Deferred {
  fn: FunctionNode;
  context: Context;
  scopes: Node[];
  parents: Node[];
}

/** How many helpers deep a call is followed into the functions it calls, far more than real suites nest. */
const MAX_DEPTH = 16;

/**
 * How many helper calls are followed in one file, and from each call in a test or hook, counting the calls inside the
 * helpers; far more than real suites make. Helpers that call each other in several places multiply: ten calls at each
 * of six levels are a million.
 */
const MAX_CALLS = 10_000;

/**
 * How many loop passes and describe cases `expandCases` walks one by one in a file, far more than real suites expand;
 * past it, loops and describe tables are one record, so that a long loop over test data can't use up the walk.
 */
const MAX_EXPANDED = 1000;

/** Where a function is written or called: in which describe, function, conditions and loop. */
interface Placement {
  scope: Scope;
  helper: Node | null;
  guards: string | null;
  isInLoop: boolean;
  /** In a test or hook body. */
  inBody: boolean;
}

/** Where a function with a name is written, and the function with a name around it. */
interface Written extends Placement {
  declaredIn: Node | null;
}

/** Whether a function is called where it is written, so that its tests are registered there. */
function calledWhereWritten(call: Placement, written: Placement): boolean {
  return (
    call.scope === written.scope &&
    call.helper === written.helper &&
    call.guards === written.guards &&
    call.isInLoop === written.isInLoop &&
    !call.inBody
  );
}

/** What a helper function does when called: set a state, a mode or locks, or call another helper in the file. */
type Effect =
  | { kind: 'state'; setting: StateSetting; call: CallExpression }
  | { kind: 'configure'; mode: Mode | null; locks: string[]; call: CallExpression }
  | { kind: 'run'; settings: RunSettings; argument: string | null; call: CallExpression }
  | { kind: 'call'; fn: Node; guards: string[] };

/** A call to a helper function from a test or a hook, whose states apply to that test or the tests the hook covers. */
interface HelperCall {
  call: CallExpression;
  fn: Node;
  target: PendingTest | Scope;
  /** The hook the call is in; null for a call from a test body. */
  hookName: keyof HookCounts | null;
  guards: string[];
}

const LOOP_METHODS = new Set(['forEach', 'map']);

/** A declaration as the walk records it: one case of its table, with its index and arguments, or the whole of it. */
interface Case<T> {
  declaration: T;
  index: number | null;
  args: Resolved[] | null;
}

/**
 * Whether a statement leaves on every path through it, with `return` or `throw`, or with `break` or `continue` aimed
 * at a loop or label outside it, so that what follows it in its block doesn't run. `labels` are those declared inside.
 */
function alwaysLeaves(statement: Node, labels: ReadonlySet<string> = new Set()): boolean {
  switch (statement.type) {
    case 'ReturnStatement':
    case 'ThrowStatement':
      return true;
    case 'BreakStatement':
    case 'ContinueStatement':
      return statement.label === null || !labels.has(statement.label.name);
    case 'BlockStatement':
      return statement.body.some((item) => alwaysLeaves(item, labels));
    case 'IfStatement':
      return (
        statement.alternate !== null &&
        alwaysLeaves(statement.consequent, labels) &&
        alwaysLeaves(statement.alternate, labels)
      );
    case 'LabeledStatement':
      return alwaysLeaves(statement.body, new Set([...labels, statement.label.name]));
    case 'TryStatement':
      return (
        (statement.finalizer !== null && alwaysLeaves(statement.finalizer, labels)) ||
        (alwaysLeaves(statement.block, labels) &&
          (statement.handler === null || alwaysLeaves(statement.handler.body, labels)))
      );
    default:
      // A loop or switch takes the `break` and `continue` inside it, and may run its body not at all.
      return false;
  }
}

/**
 * The names a condition reads, as in `side === 'buy'` or `!strategy.enabled`; null when it has a function, which the
 * scan doesn't look into.
 */
function referencedNames(node: Node): string[] | null {
  if (isFunctionNode(node)) return null;
  if (node.type === 'Identifier') return [node.name];
  const parts = node.type === 'MemberExpression' && !node.computed ? [node.object] : childNodes(node);
  const names: string[] = [];
  for (const part of parts) {
    const found = referencedNames(part);
    if (!found) return null;
    names.push(...found);
  }
  return names;
}

/**
 * Whether a loop body can end a pass before its end or stop the loop, with `break`, `continue`, `return` or `throw`,
 * so that a test in it may not be registered on every pass. Functions inside run later, and don't count.
 */
function leavesEarly(body: Node, continueOnly = false): boolean {
  if (body.type === 'FunctionDeclaration' || isFunctionNode(body)) return false;
  switch (body.type) {
    case 'BreakStatement':
    case 'ReturnStatement':
    case 'ThrowStatement':
      return !continueOnly;
    case 'ContinueStatement':
      return true;
  }
  return childNodes(body).some((child) => leavesEarly(child, continueOnly));
}

/**
 * What `test.describe.configure()` sets on the describe or file it is called in: the last mode, timeout and retries
 * win, locks add up.
 */
function configure(scope: Scope, settings: { mode: Mode | null; locks: string[]; run: RunSettings }): void {
  if (settings.mode) scope.mode = settings.mode;
  scope.details.locks.push(...settings.locks);
  mergeRun(scope.details.run, settings.run);
}

/**
 * Applies settings written later in the same place: the last value of each wins, and a test is slow when any
 * `test.slow()` applies.
 */
export function mergeRun(target: RunSettings, later: RunSettings): void {
  const { slow, ...rest } = later;
  Object.assign(target, rest);
  if (slow) target.slow = target.slow ? anySlow([target.slow, slow]) : slow;
}

/** Any of several `test.slow()` calls: always when one always applies, otherwise under any of their conditions. */
export function anySlow(slows: NonNullable<RunSettings['slow']>[]): NonNullable<RunSettings['slow']> {
  const lists = slows.map((slow) => slow.conditions);
  if (lists.includes(null)) return { conditions: null };
  return { conditions: [...new Set((lists as string[][]).flat())] };
}

/** Conditions joined with `||`, adding parentheses where a part could otherwise be read differently. */
export function eitherCondition(parts: string[]): string {
  return parts.map((part) => (parts.length > 1 && /\?|,/.test(part) ? `(${part})` : part)).join(' || ');
}

/** A warning for a test or describe titled with an empty string, which reports can't tell apart. */
function emptyTitle(declaration: TestDeclaration | SuiteDeclaration, call: CallExpression): Problem[] {
  const { title } = declaration;
  if (title?.text !== '' || title.isDynamic) return [];
  const what = declaration.kind === 'test' ? 'test' : 'describe';
  return [problem('empty-title', call, `The ${what} has an empty title, so reports and filters can't tell it apart.`)];
}

/** Hooks that run around each test, whose fixtures the test uses too. */
const EACH_HOOKS = new Set<keyof HookCounts>(['beforeEach', 'afterEach', 'aroundEach']);

export function noHooks(): HookCounts {
  return { beforeAll: 0, beforeEach: 0, afterEach: 0, afterAll: 0, aroundEach: 0, aroundAll: 0 };
}

/** Joins conditions with `&&`, adding parentheses where a part could otherwise be read differently. */
function joinConditions(parts: string[]): string | null {
  if (parts.length <= 1) return parts[0] ?? null;
  return parts.map((part) => (/\|\||\?|,/.test(part) ? `(${part})` : part)).join(' && ');
}

/** Directives for linters, compilers, formatters and coverage tools, which say nothing about the test. */
const DIRECTIVE =
  /^(?:eslint-(?:disable|enable)|eslint\s|global\s|@ts-(?:ignore|expect-error|nocheck|check)|prettier-ignore|istanbul\s+ignore|[cv]8\s+ignore|biome-ignore|oxlint-(?:disable|enable)|deno-lint-ignore|tslint:)/;

function commentLines(comment: { type: 'Line' | 'Block'; value: string }): string[] {
  const lines =
    comment.type === 'Line'
      ? [comment.value.trim()]
      : splitLines(comment.value).map((line) => line.replace(/^\s*\*?\s*/, '').trimEnd());
  return lines.filter((line) => line !== '' && !DIRECTIVE.test(line));
}

/** A component or the object of a JSX member tag reads a binding. Intrinsic tags and attribute names are strings. */
function jsxReference(name: string, field: string | null, parent: Node | null): boolean {
  if (parent?.type === 'JSXMemberExpression') return field === 'object';
  return (
    (parent?.type === 'JSXOpeningElement' || parent?.type === 'JSXClosingElement') &&
    field === 'name' &&
    !/^[a-z]/.test(name)
  );
}

/** References that keep imported values in Playwright's emitted TypeScript. Look up the binding at the use
 * so a local parameter or a property with the same name cannot keep an import alive. */
function runtimeReferences(frame: Frame): Set<Node> {
  const used = new Set<Node>();
  let hasJsx = false;
  const scopes: Node[] = [];
  const program = frame.parsed.program;
  const imports = new Map<string, Node>();
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration')
      for (const specifier of statement.specifiers) imports.set(specifier.local.name, specifier);
  }
  const visit = (node: Node, field: string | null, parent: Node | null): void => {
    if (
      node.type === 'ImportDeclaration' ||
      ('declare' in node && node.declare) ||
      (node.type === 'ExportNamedDeclaration' && (node.source || node.exportKind === 'type')) ||
      (node.type === 'ExportSpecifier' && node.exportKind === 'type')
    )
      return;
    if (node.type.startsWith('TS') && !TS_RUNTIME.has(node.type)) return;
    const scoped = isScopeNode(node);
    if (scoped) scopes.push(node);
    if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
      const imported = imports.get(node.name);
      const readsValue =
        node.type === 'Identifier' ? isReference(field, parent) : jsxReference(node.name, field, parent);
      if (imported && readsValue && frame.values.declarationOf(node.name, scopes) === imported) used.add(imported);
    }
    if (!hasJsx && (node.type === 'JSXElement' || node.type === 'JSXFragment')) {
      hasJsx = true;
      const factories = new Map([
        ['jsx', 'React'],
        ['jsxFrag', 'React'],
      ]);
      for (const comment of frame.parsed.comments) {
        const pragma = /@(jsx(?:Frag)?)\s+([^\s.]+)/.exec(comment.value);
        if (pragma) factories.set(pragma[1], pragma[2]);
      }
      for (const name of factories.values()) {
        const binding = frame.values.declarationOf(name, [program]);
        if (binding) used.add(binding);
      }
    }
    const fields = node as unknown as Record<string, unknown>;
    for (const key of visitorKeys[node.type]) {
      const value = fields[key];
      if (Array.isArray(value)) {
        for (const child of value as (Node | null)[]) if (child) visit(child, key, node);
      } else if (value) visit(value as Node, key, node);
    }
    if (scoped) scopes.pop();
  };
  visit(program, null, null);
  return used;
}

const TS_RUNTIME = new Set<string>([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'TSInstantiationExpression',
  'TSEnumDeclaration',
  'TSEnumBody',
  'TSEnumMember',
  'TSModuleDeclaration',
  'TSModuleBlock',
  'TSParameterProperty',
  'TSExportAssignment',
  'TSImportEqualsDeclaration',
  'TSExternalModuleReference',
]);

export function initializesLocalModule(source: string): boolean {
  return source !== '@playwright/test' && source !== 'playwright/test' && !isBuiltin(source);
}

class Walker {
  private readonly scopes: Node[] = [];
  private readonly parents: Node[] = [];
  private readonly fileScope: Scope;
  private readonly suites: PendingSuite[] = [];
  private readonly tests: PendingTest[] = [];
  private readonly problems: Problem[] = [];
  /** The scanned file. */
  private readonly main: Frame;
  /** The file whose code is being walked: the scanned file, or the module of an imported helper. */
  private frame: Frame;
  /** While an imported helper is walked, the call in the scanned file that walks it; records and problems point there. */
  private site: Node | null = null;
  private readonly loaded = new Set<string>();
  private readonly valueImports = new WeakMap<Frame, Set<Node>>();
  private importDepth = 0;
  private unknownRegistration = false;
  private readonly openModule: OpenModule;
  private readonly frames = new Map<ModuleSource, Frame | null>();
  /** Problems of helper modules' own imports, reported once, at the first call that walks the module. */
  private readonly moduleProblems = new Set<Problem>();
  /** The file each describe is written in, so that a describe's body hash only leaves out code from its own file. */
  private readonly suiteFrames = new WeakMap<PendingSuite, Frame>();
  private readonly effects = new Map<Node, Effect[]>();
  private readonly helperCalls: HelperCall[] = [];
  /** Where each function with a name is written, outside test and hook bodies. */
  private readonly written = new Map<Node, Written>();
  /**
   * Every call by name to a function declared in the file, once per call: a call inside a helper is walked again each
   * time the helper is, and the first walk, from where the helper is called, places it.
   */
  private readonly callSites = new Map<Node, Map<Node, Placement>>();
  /**
   * The function with a name each test is declared in, which registers the test when it is called, and the helper call
   * in it that registers the test, if any.
   */
  private readonly declaredIn = new Map<PendingTest, { fn: Node; call: CallExpression | null }>();
  private readonly deferred: Deferred[] = [];
  private continuations: ((root: Registration) => void)[] = [];
  private readonly isDeferred = new Set<Node>();
  /**
   * Functions walked at one of their calls, or as a test or hook body passed by name, so that their tests are recorded
   * where they are registered and what they set isn't reported as unapplied.
   */
  private readonly walkedAtCall = new Set<Node>();
  /** The functions being walked at their calls, innermost last, to stop recursion. */
  private readonly callStack: Node[] = [];
  /** Helper calls walked in the file so far, up to MAX_CALLS. */
  private callsWalked = 0;
  /** Loop passes and describe cases walked one by one so far, up to MAX_EXPANDED. */
  private expandedPasses = 0;
  /** Problems already reported, since a function walked at several calls finds the same ones each time. */
  private readonly reported = new Set<string>();
  /** What the functions named in calls such as `onNode(22)('title', fn)` return, by the declaration of each name. */
  private readonly returns = new Map<Node, Returns | null>();
  /** For each file's program, the scopes around each function in it. */
  private readonly scopeChains = new Map<Node, Map<Node, Node[]>>();

  private readonly options: ExtractOptions;

  constructor(main: Frame, openModule: OpenModule, options: ExtractOptions) {
    this.options = options;
    this.main = main;
    this.loaded.add(main.relativeFilePath);
    this.frame = main;
    this.openModule = openModule;
    const { adapter } = main;
    this.fileScope = {
      kind: 'file',
      parent: null,
      states: [],
      mode: null,
      isOnly: false,
      details: { tags: adapter.fileTags, annotations: [], locks: [], meta: null, run: {} },
      hooks: noHooks(),
      hookRun: {},
      hookFixtures: [],
      setupFixtures: [],
      takesAllFixtures: false,
      suite: null,
    };
  }

  run(): Extraction {
    const registration: Context['registration'] = this.main.adapter.catchesSuiteErrors ? {} : undefined;
    this.visit(this.main.parsed.program, {
      registration,
      scope: this.fileScope,
      test: null,
      hookScope: null,
      hookName: null,
      stepDepth: 0,
      testContext: null,
      guards: [],
      isInLoop: false,
      loops: [],
      loopConditions: [],
      caseIndex: null,
      isExpanding: false,
      expandedAt: null,
      isInCondition: false,
      isInFunction: false,
      helper: null,
      declaredIn: null,
      calledIn: null,
      quiet: false,
      registeredBy: null,
    });
    if (registration) {
      while (this.continuations.length) {
        const batch = this.continuations;
        this.continuations = [];
        for (const resume of batch) resume(registration);
      }
    }
    // Functions defined inside these are deferred in turn; the loop reaches them too, as they are added to the end.
    for (const entry of this.deferred) this.walkWhereWritten(entry);
    // Records follow the order the file registers them in; the sort is stable, so one call's tests keep theirs.
    this.tests.sort((a, b) => a.order - b.order);
    this.suites.sort((a, b) => a.order - b.order);
    const exported = this.exportedFunctions(this.main.parsed.program);
    this.applyHelpers(exported);
    this.checkFunctionTests(exported);
    return {
      suites: this.suites,
      registrationStoppedAt: registration?.stoppedAt,
      tests: this.tests,
      problems: [...this.main.adapter.problems, ...this.problems],
      hooks: this.fileScope.hooks,
      usesGlobals: this.main.adapter.usesGlobals,
      unknownRegistration: this.unknownRegistration,
      fileTags: this.main.adapter.fileTags.map((name, index) => ({
        name,
        span: this.main.adapter.fileTagSpans[index],
      })),
    };
  }

  private currentScope(context: Context): Context {
    const scope = context.registration?.scope;
    return scope && scope !== context.scope ? { ...context, scope } : context;
  }

  private visit(node: Node, context: Context): void {
    const isScope = isScopeNode(node);
    if (isScope) this.scopes.push(node);
    this.parents.push(node);
    this.visitNode(node, this.currentScope(context));
    this.parents.pop();
    if (isScope) this.scopes.pop();
  }

  private visitChildren(node: Node, context: Context): void {
    for (const child of childNodes(node)) this.visit(child, context);
  }

  private visitNode(node: Node, context: Context): void {
    const task = context.registration?.asyncCall;
    if (task && (context.skipImports || task.pending || context.registration?.stoppedAt !== undefined)) return;
    if (context.evaluatingArgument && context.registration) {
      if (
        context.skipImports ||
        context.registration.stoppedAt !== undefined ||
        node.type === 'FunctionDeclaration' ||
        isFunctionNode(node)
      )
        return;
      const step = context.parameterSteps?.get(node);
      if (step === 'throw') {
        this.stopRegistration(node, context);
        return;
      }
      if (node.type === 'AssignmentPattern' && step !== undefined) {
        this.visitBranch(node.right, context, `${this.text(node.left)} === undefined`, step);
        this.visit(node.left, context);
        return;
      }
      if (node.type === 'SpreadElement' && this.parents.at(-2)?.type !== 'ObjectExpression') {
        this.visit(node.argument, context);
        const value = this.frame.values.resolve(node.argument, this.scopes);
        if (value.ok && nonIterable(value.value)) this.stopRegistration(node, context);
        return;
      }
      if (node.type === 'ClassBody') {
        // Class creation computes the keys first, then initializes static elements in declaration order.
        for (const member of node.body) if ('computed' in member && member.computed) this.visit(member.key, context);
        for (const member of node.body) {
          if (member.type === 'StaticBlock') this.visit(member, context);
          else if (
            (member.type === 'PropertyDefinition' || member.type === 'AccessorProperty') &&
            member.static &&
            member.value
          )
            this.visit(member.value, context);
        }
        return;
      }
    }
    if (
      this.options.collectImports &&
      !context.skipImports &&
      !context.test &&
      !context.hookScope &&
      !context.helper &&
      !context.quiet
    )
      this.collectImport(node, context);
    switch (node.type) {
      case 'AwaitExpression': {
        this.visit(node.argument, context);
        const registration = context.registration;
        if (registration?.asyncCall && registration.stoppedAt === undefined) {
          registration.asyncCall.atAwait ??= { scope: registration.scope };
          const failure = this.awaitedFailure(node.argument);
          if (failure === 'pending') registration.asyncCall.pending = true;
          if (failure === 'rejected') this.stopRegistration(node, context);
        }
        return;
      }
      case 'CallExpression': {
        if (context.test && !context.quiet) this.expectCall(node, context.test);
        const helper = this.helperCall(node, context);
        if (this.call(node, context) || this.loopCall(node, context)) return;
        if (!helper) {
          this.visitChildren(node, context);
          return;
        }
        if (helper.fn !== unwrap(node.callee)) this.visit(node.callee, context);
        const stopped = this.registrationArguments(node, context);
        if (stopped) this.walkedAtCall.add(helper.fn);
        else {
          if (stopped === null) for (const arg of node.arguments) this.visit(arg, context);
          this.walkAtCall(helper, node, context, stopped !== null);
        }
        return;
      }
      case 'IfStatement':
      case 'ConditionalExpression': {
        // In-source tests sit inside `if (import.meta.vitest)`, which is how they are written, not a condition.
        if (node.type === 'IfStatement' && isImportMetaVitest(node.test)) break;
        const condition = this.text(node.test);
        this.visit(node.test, context);
        const known = this.known(node.test, context);
        this.visitBranch(node.consequent, context, condition, known && Boolean(known.value));
        if (node.alternate) this.visitBranch(node.alternate, context, `!(${condition})`, known && !known.value);
        return;
      }
      case 'LogicalExpression': {
        const left = this.text(node.left);
        const guard = node.operator === '&&' ? left : node.operator === '||' ? `!(${left})` : `(${left}) == null`;
        this.visit(node.left, context);
        const known = this.known(node.left, context);
        const right =
          known &&
          (node.operator === '&&'
            ? Boolean(known.value)
            : node.operator === '||'
              ? !known.value
              : known.value === null || known.value === undefined);
        this.visitBranch(node.right, context, guard, right);
        return;
      }
      case 'TryStatement': {
        const attempt = context.registration && { ...context.registration };
        this.visit(node.block, { ...context, registration: attempt, handlesRegistrationError: !!attempt });
        let failure = attempt?.stoppedAt;
        let scope = attempt?.recoveryScope ?? attempt?.scope;
        const exit =
          node.handler && attempt && failure === undefined
            ? this.frame.adapter.registrationExit?.(node.block, this.scopes)
            : undefined;
        if (node.handler && exit !== 'next' && exit !== 'return') {
          const handler = this.guarded(context, this.catchCondition(node.handler));
          if (handler.registration) {
            handler.registration.scope = scope;
            if (failure !== undefined) handler.registration.asyncCall = attempt?.asyncCall;
          }
          this.visit(node.handler, handler);
          if (failure !== undefined && handler.registration) {
            failure = handler.registration.stoppedAt;
            scope = handler.registration.recoveryScope ?? handler.registration.scope;
          }
        }
        if (context.registration) context.registration.scope = scope;
        if (node.finalizer) {
          this.visit(node.finalizer, context);
          if (failure !== undefined && this.frame.adapter.registrationExit?.(node.finalizer, this.scopes) === 'return')
            failure = undefined;
        }
        if (context.registration && failure !== undefined) context.registration.stoppedAt ??= failure;
        return;
      }
      case 'ThrowStatement':
        this.visit(node.argument, context);
        this.stopRegistration(node, context);
        return;
      case 'SwitchStatement': {
        const discriminant = this.text(node.discriminant);
        const values = node.cases.flatMap((switchCase) => (switchCase.test ? [this.text(switchCase.test)] : []));
        // The default case runs when no other case matches.
        const otherwise = values.map((value) => `${discriminant} !== ${value}`).join(' && ');
        this.visit(node.discriminant, context);
        const start = this.switchStart(node, context);
        let fallsThrough = false;
        for (const [index, switchCase] of node.cases.entries()) {
          const guard = switchCase.test ? `${discriminant} === ${this.text(switchCase.test)}` : otherwise;
          const guarded = this.guarded(context, guard === '' ? null : guard);
          const executes: boolean = start === null || index === start || fallsThrough;
          this.visit(switchCase, executes ? guarded : { ...guarded, skipImports: true });
          fallsThrough = executes && !switchCase.consequent.some((statement) => alwaysLeaves(statement));
        }
        return;
      }
      case 'SwitchCase':
        if (node.test) this.visit(node.test, context);
        this.visitStatements(node.consequent, context);
        return;
      case 'BlockStatement':
        this.visitStatements(node.body, context);
        return;
      case 'ForInStatement':
      case 'ForOfStatement': {
        const leaves = leavesEarly(node.body);
        const iterable = this.loopValues(node);
        const values = leaves ? null : iterable;
        const expands = values ? this.expands(node, values, context) : 'no';
        if (values && expands === 'yes') {
          this.expandLoop(node, values, context);
          return;
        }
        // For `for...in`, the keys are what `Object.keys()` lists.
        const listed = node.type === 'ForOfStatement' && !leaves ? node.right : null;
        const count = values?.length ?? (listed ? this.frame.values.lengthOf(listed, this.scopes.slice(0, -1)) : null);
        this.walkUnexpanded(node, expands === 'limit', () => {
          this.visit(node.right, context);
          const loop = this.inLoop(context, count);
          const body = iterable?.length === 0 ? { ...loop, skipImports: true } : loop;
          this.visit(node.left, body);
          this.visit(node.body, body);
        });
        return;
      }
      case 'ForStatement':
      case 'WhileStatement': {
        const loop = this.inLoop(context, null);
        if (node.type === 'ForStatement' && node.init) this.visit(node.init, loop);
        if (node.test) this.visit(node.test, loop);
        const condition = node.test && this.known(node.test, context);
        const body = condition && !condition.value ? { ...loop, skipImports: true } : loop;
        this.visit(node.body, body);
        if (node.type === 'ForStatement' && node.update) this.visit(node.update, this.loopTail(node.body, body));
        return;
      }
      case 'DoWhileStatement': {
        const loop = this.inLoop(context, null);
        this.visit(node.body, loop);
        this.visit(node.test, this.loopTail(node.body, loop));
        return;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        // A function outside any test or hook runs when it is called; what it sets applies where it is called.
        const helper = context.test || context.hookScope ? null : node;
        const named = helper !== null && this.isNamed(node);
        // In an imported helper's module, a function runs only when it is called, and is walked then.
        if (this.frame !== this.main && (named || (this.importDepth > 0 && !context.test && !context.hookScope)))
          return;
        if (named && !this.isDeferred.has(node)) {
          // Its calls decide where its tests are registered, and a call may come after it, so it waits.
          this.written.set(node, { ...this.placement(context), declaredIn: context.declaredIn });
          this.isDeferred.add(node);
          this.deferred.push({ fn: node, context, scopes: [...this.scopes], parents: [...this.parents] });
          return;
        }
        if (named) return;
        this.visitChildren(node, {
          ...context,
          isInFunction: true,
          helper: helper ?? context.helper,
          registration: undefined,
          guards: helper ? [] : context.guards,
        });
        return;
      }
    }
    this.visitChildren(node, context);
  }

  /** Static module loads run once during collection. Keep the location of the import in the entry spec and
   * the declaration's own location in the loaded module, just as for a helper invoked at a call site. */
  private collectImport(node: Node, context: Context): void {
    let source: string | null;
    if (node.type === 'ImportDeclaration' && node.importKind !== 'type') {
      source = node.source.value;
      if (node.specifiers.length && /\.[cm]?tsx?$/.test(this.frame.relativeFilePath)) {
        let used = this.valueImports.get(this.frame);
        if (!used) {
          used = runtimeReferences(this.frame);
          this.valueImports.set(this.frame, used);
        }
        if (
          !node.specifiers.some(
            (item) => (item.type !== 'ImportSpecifier' || item.importKind !== 'type') && used.has(item),
          )
        )
          return;
      }
    } else if (
      (node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') &&
      node.source &&
      node.exportKind !== 'type'
    ) {
      if (
        node.type === 'ExportNamedDeclaration' &&
        node.specifiers.length &&
        node.specifiers.every((item) => item.exportKind === 'type')
      )
        return;
      source = node.source.value;
    } else if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'require' &&
      !this.frame.values.declarationOf('require', this.scopes)
    )
      source = requiredModule(node);
    else if (node.type === 'ImportExpression') source = null;
    else return;
    if (source !== null && !initializesLocalModule(source)) return;
    const frame = source !== null ? this.openFrom(this.frame, source) : null;
    if (!frame || this.importDepth >= MAX_DEPTH) {
      this.unknownRegistration = true;
      return;
    }
    if (this.loaded.has(frame.relativeFilePath)) return;
    this.loaded.add(frame.relativeFilePath);
    if (this.options.initializeModule?.(frame.relativeFilePath) === false) return;
    const caller = this.frame;
    const site = this.site;
    const scopes = this.scopes.splice(0);
    const parents = this.parents.splice(0);
    this.frame = frame;
    this.site ??= node;
    this.importDepth++;
    this.visit(frame.parsed.program, { ...context, registeredBy: context.registeredBy ?? node });
    this.importDepth--;
    this.scopes.push(...scopes);
    this.parents.push(...parents);
    this.site = site;
    this.frame = caller;
  }

  /** A continue reaches the update or trailing condition of its loop. A break, return or throw skips it. */
  private loopTail(body: Node, context: Context): Context {
    return this.options.collectImports && alwaysLeaves(body) && !leavesEarly(body, true)
      ? { ...context, skipImports: true }
      : context;
  }

  /** Whether a function has a name it can be called by: `function name() {}` or `const name = () => {}`. */
  private isNamed(fn: Node): boolean {
    const parent = this.parents.at(-2);
    return (
      (fn.type === 'FunctionDeclaration' && fn.id !== null) ||
      (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier' && parent.init === fn)
    );
  }

  /**
   * With `expandCases`, the value of a condition outside test and hook bodies when the scan can work it out, as with
   * the values of a case or pass; null otherwise, and then both branches are walked under the condition.
   */
  private known(test: Expression, context: Context): { value: Value } | null {
    if (
      (!this.options.expandCases && !this.options.collectImports && !context.registration) ||
      context.test ||
      context.hookScope
    )
      return null;
    // Only the values of the case, pass or helper call decide: a constant of the module may be changed in ways the scan
    // doesn't see, and taking a branch away would drop a test the runner registers.
    const names = referencedNames(test);
    if (!names?.every((name) => this.frame.values.isBound(name, this.scopes))) return null;
    const resolved = this.frame.values.resolve(test, this.scopes);
    return resolved.ok ? { value: resolved.value } : null;
  }

  /**
   * Walks the statements of a block. After an `if` whose branch always leaves the function or loop, as in
   * `if (!strategy.enabled) return;`, what follows runs only when that branch isn't taken, so it is under the opposite
   * condition; a branch taken for certain, or both branches leaving, ends the walk. A branch that leaves on only some
   * of its paths leaves what follows as it is.
   */
  private visitStatements(statements: readonly Node[], context: Context, start = 0): void {
    let current = context;
    for (let index = start; index < statements.length; index++) {
      const task = current.registration?.asyncCall;
      if (task?.atAwait && task.body === this.parents.at(-1)) {
        if (!current.skipImports && !task.pending && current.registration?.stoppedAt === undefined)
          this.deferStatements(statements, index, current, task.body);
        return;
      }
      const statement = statements[index];
      this.visit(statement, current);
      if (statement.type !== 'IfStatement') {
        if ((this.options.collectImports || context.registration) && alwaysLeaves(statement))
          current = { ...current, skipImports: true };
        continue;
      }
      if (isImportMetaVitest(statement.test)) continue;
      const thenLeaves = alwaysLeaves(statement.consequent);
      const elseLeaves = statement.alternate !== null && alwaysLeaves(statement.alternate);
      if (!thenLeaves && !elseLeaves) continue;
      const known = this.known(statement.test, current);
      const taken = known && (known.value ? thenLeaves : elseLeaves);
      if ((taken && this.options.expandCases) || (thenLeaves && elseLeaves)) return;
      if (known && (this.options.expandCases || (context.registration && !taken))) continue;
      const condition = this.text(statement.test);
      current = this.guarded(current, thenLeaves ? `!(${condition})` : condition);
      if (taken) current.skipImports = true;
    }
  }

  /** Terminal outcomes of the built-in Promise constructor and its static methods that the scan can prove. */
  private awaitedFailure(expression: Expression): 'pending' | 'rejected' | null {
    if (
      this.frame.values.declarationOf('Promise', this.scopes) ||
      this.frame.values.assignedIn(this.frame.parsed.program).has('Promise')
    )
      return null;
    let node = unwrap(expression);
    while (node.type === 'CallExpression') {
      const method = unwrap(node.callee);
      if (method.type !== 'MemberExpression' || method.object.type !== 'Identifier' || method.object.name !== 'Promise')
        return null;
      if (propertyName(method) === 'reject') return 'rejected';
      const value = node.arguments.at(0);
      if (propertyName(method) !== 'resolve' || !value || value.type === 'SpreadElement') return null;
      node = unwrap(value);
    }
    if (node.type !== 'NewExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'Promise')
      return null;
    const executor = node.arguments[0];
    if (
      !isFunctionNode(executor) ||
      !executor.params.every((p) => p.type === 'Identifier') ||
      executor.body?.type !== 'BlockStatement'
    )
      return null;
    return executor.body.body.every(
      (s) =>
        s.type === 'VariableDeclaration' &&
        ['var', 'let', 'const'].includes(s.kind) &&
        s.declarations.every((d) => d.id.type === 'Identifier' && d.init?.type === 'Literal'),
    )
      ? 'pending'
      : null;
  }

  /** Resume in the active file suite, retaining the lexical environment where the helper suspended. */
  private deferStatements(statements: readonly Node[], index: number, context: Context, body: Node): void {
    const { frame, site, importDepth } = this;
    const scopes = this.scopes.slice(),
      parents = this.parents.slice(),
      calls = this.callStack.slice();
    this.continuations.push(
      frame.values.captureBindings<Registration>((root) => {
        this.frame = frame;
        this.site = site;
        this.importDepth = importDepth;
        this.scopes.push(...scopes);
        this.parents.push(...parents);
        this.callStack.push(...calls);
        this.asyncRegistration(root, body, (registration) => {
          this.visitStatements(
            statements,
            {
              ...context,
              scope: root.scope ?? this.fileScope,
              registration,
              emptySuiteAt: undefined,
              expandedAt: this.main.parsed.program.end + 1,
            },
            index,
          );
        });
        this.callStack.length = this.parents.length = this.scopes.length = 0;
        this.importDepth = 0;
        this.site = null;
        this.frame = this.main;
      }),
    );
  }

  private asyncRegistration(caller: Registration, body: Node, visit: (registration: Registration) => void): void {
    const asyncCall: AsyncRegistration = { body };
    const registration = { ...caller, asyncCall };
    visit(registration);
    caller.scope = asyncCall.atAwait ? asyncCall.atAwait.scope : (registration.recoveryScope ?? registration.scope);
  }

  private placement(context: Context): Placement {
    return {
      scope: context.scope,
      helper: context.helper,
      guards: joinConditions(context.guards),
      isInLoop: context.isInLoop,
      inBody: context.test !== null || context.hookScope !== null,
    };
  }

  /** A `catch` block's condition, written as its clause: `catch` or `catch (error)`. */
  private catchCondition(handler: CatchClause): string {
    return this.text({ start: handler.start, end: handler.body.start }).trim();
  }

  /** First case entered at collection, -1 for none, or null when a value cannot be determined. */
  private switchStart(node: Extract<Node, { type: 'SwitchStatement' }>, context: Context): number | null {
    if (!this.options.collectImports) return null;
    const key = this.known(node.discriminant, context);
    if (!key || (key.value !== null && typeof key.value === 'object')) return null;
    let fallback = -1;
    for (const [index, entry] of node.cases.entries()) {
      if (entry.test === null) fallback = index;
      else {
        const value = this.known(entry.test, context);
        if (!value) return null;
        if (value.value === key.value) return index;
      }
    }
    return fallback;
  }

  private visitBranch(node: Node, context: Context, guard: string, selected: boolean | null): void {
    if (selected !== null && (this.options.expandCases || context.evaluatingArgument)) {
      if (selected) this.visit(node, context);
      return;
    }
    const guarded = this.guarded(context, guard, selected === true);
    this.visit(node, selected === false ? { ...guarded, skipImports: true } : guarded);
  }

  private guarded(context: Context, guard: string | null, certain = false): Context {
    return {
      ...context,
      isInCondition: true,
      guards: guard === null ? context.guards : [...context.guards, guard],
      registration: certain ? context.registration : possibleRegistration(context.registration),
    };
  }

  private stopRegistration(node: Span, context: Context): void {
    if (context.registration && !context.skipImports) context.registration.stoppedAt ??= this.lineOf(node);
  }

  /** Visits the body of a callback the framework or a loop calls, rather than a plain function. */
  private visitCallback(fn: FunctionNode, context: Context, parameterSteps?: ReadonlyMap<Node, ParameterStep>): void {
    this.scopes.push(fn);
    this.parents.push(fn);
    const bindings = parameterSteps ? { ...context, evaluatingArgument: true, parameterSteps } : context;
    for (const parameter of fn.params) this.visit(parameter, bindings);
    // Function expressions and arrows always have a body; only declarations of overloads don't.
    if (!parameterSteps || (!fn.generator && bindings.registration?.stoppedAt === undefined))
      this.visit(fn.body as Node, context);
    this.parents.pop();
    this.scopes.pop();
  }

  private text(node: Span): string {
    return snippet(this.frame.parsed.source.slice(node.start, node.end));
  }

  /** `pass` is the pass of an expanded loop, and where the loop starts. */
  private inLoop(context: Context, passes: number | null, pass: { index: number; at: number } | null = null): Context {
    return {
      ...context,
      isInLoop: true,
      registration: passes ? context.registration : possibleRegistration(context.registration),
      loops: [...context.loops, passes],
      loopConditions: [...context.loopConditions, context.isInCondition || pass !== null],
      caseIndex: pass?.index ?? context.caseIndex,
      isExpanding: context.isExpanding || pass !== null,
      expandedAt: this.expandedAt(context, pass?.at ?? null),
    };
  }

  /**
   * Where what an expansion registers is ordered: the outermost expansion in the scanned file. In a helper walked at a
   * call, the call already orders what it registers, and the helper may be in another file.
   */
  private expandedAt(context: Context, at: number | null): number | null {
    return context.expandedAt ?? (context.registeredBy === null ? at : null);
  }

  /**
   * Whether to walk a loop or describe table once per value: with `expandCases`, outside test and hook bodies, which
   * the runner walks once for each test, for a loop that declares its variable with `let` or `const`. An expansion
   * outside any other starts only while the file has expanded fewer than MAX_EXPANDED passes and cases, so that a long
   * loop over test data can't use up the walk; inside one, loops expand up to ten times that, so that an expansion
   * is whole. `limit` means the limit is why it doesn't.
   */
  private expands(
    loop: Extract<Node, { type: 'ForOfStatement' | 'ForInStatement' }> | null,
    values: readonly unknown[],
    context: Context,
  ): 'yes' | 'no' | 'limit' {
    if (!this.options.expandCases || context.test || context.hookScope) return 'no';
    // Vitest runs describe callbacks after the loop, when a `var` holds its last value.
    if (loop && !(loop.left.type === 'VariableDeclaration' && loop.left.kind !== 'var')) return 'no';
    const limit = context.isExpanding ? 10 * MAX_EXPANDED : MAX_EXPANDED;
    if (this.expandedPasses + values.length > limit) return 'limit';
    this.expandedPasses += values.length;
    return 'yes';
  }

  /**
   * Walks a loop as one record, and says why it isn't expanded when it was asked to be and registers tests or
   * describes.
   */
  private walkUnexpanded(node: Node, limited: boolean, walk: () => void): void {
    const before = this.tests.length + this.suites.length;
    walk();
    if (!limited || this.tests.length + this.suites.length === before) return;
    this.report(
      problem(
        'cases-not-expanded',
        node,
        `The passes of the loop are listed as one record, since expanding it would take the file past ${MAX_EXPANDED.toLocaleString('en-US')} loop passes and describe cases.`,
      ),
    );
  }

  /**
   * Walks the body of `for...of` or `for...in` once per value, with the loop variable bound to it, as the runner runs
   * it; false when the loop doesn't declare its variable, as in `for (symbol of SYMBOLS)`.
   */
  private expandLoop(
    loop: Extract<Node, { type: 'ForOfStatement' | 'ForInStatement' }>,
    values: Value[],
    context: Context,
  ): boolean {
    const declarator = (loop.left as Extract<Node, { type: 'VariableDeclaration' }>).declarations[0];
    this.visit(loop.right, context);
    for (const [index, value] of values.entries()) {
      this.frame.values.withLoopValue(declarator, declarator.id, { ok: true, value }, loop.body, this.scopes, () => {
        this.visit(loop.body, this.inLoop(context, 1, { index, at: loop.start }));
      });
    }
    return true;
  }

  /**
   * What `for...of` or `for...in` goes over, when the scan can work it out: an array's elements, or the keys of any
   * value, as `for...in` takes them; null when the value is unknown or `for...of` can't go over it.
   */
  private loopValues(loop: Extract<Node, { type: 'ForOfStatement' | 'ForInStatement' }>): Value[] | null {
    // The loop's own scope declares the loop variable, which the value it goes over can't refer to.
    const resolved = this.frame.values.resolve(loop.right, this.scopes.slice(0, -1));
    if (!resolved.ok) return null;
    if (loop.type === 'ForInStatement') return Object.keys(Object(resolved.value ?? {}) as object);
    return Array.isArray(resolved.value) ? resolved.value : null;
  }

  /** `symbols.forEach((symbol) => test(...))` declares its tests in a loop. */
  private loopCall(call: CallExpression, context: Context): boolean {
    const callee = unwrap(call.callee);
    if (callee.type !== 'MemberExpression' || !LOOP_METHODS.has(propertyName(callee) ?? '')) return false;
    this.visit(call.callee, context);
    const resolved = this.frame.values.resolve(callee.object, this.scopes);
    const list = resolved.ok && Array.isArray(resolved.value) ? resolved.value : null;
    for (const arg of call.arguments) {
      if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
        const leaves = leavesEarly(arg.body as Node);
        const values = leaves ? null : list;
        const expands = values ? this.expands(null, values, context) : 'no';
        if (values && expands === 'yes') {
          // The callback gets each element, its index and the array.
          for (const [index, value] of values.entries()) {
            const args = [value, index, values].map((item): Resolved => ({ ok: true, value: item }));
            this.frame.values.withArguments(arg, args, this.scopes, () => {
              this.visitCallback(arg, this.inLoop(context, 1, { index, at: call.start }));
            });
          }
        } else {
          const count = values?.length ?? (leaves ? null : this.frame.values.lengthOf(callee.object, this.scopes));
          this.walkUnexpanded(call, expands === 'limit', () => {
            const loop = this.inLoop(context, count);
            this.visitCallback(arg, list?.length === 0 ? { ...loop, skipImports: true } : loop);
          });
        }
      } else {
        this.visit(arg, context);
      }
    }
    return true;
  }

  private call(call: CallExpression, context: Context): boolean {
    const api = this.frame.adapter.classify(call, {
      scopes: this.scopes,
      testContext: context.testContext,
      inTest: context.test !== null,
      inBody: context.test !== null || context.hookScope !== null,
      passedDown: context.scope.suite?.declaration.passesDown ?? null,
      handlesRegistrationError: !!context.registration && context.handlesRegistrationError,
      returnsOf: (name, scopes) => this.returnsOf(name, scopes),
    });
    if (!api) return false;
    if (this.registrationArguments(call, context)) return true;
    return this.handle(call, api, this.currentScope(context));
  }

  /** Whether argument evaluation stopped a call during collection, or null outside live Jasmine registration. */
  private registrationArguments(call: CallExpression, context: Context): boolean | null {
    if (!context.registration || context.skipImports || context.registration.stoppedAt !== undefined) return null;
    const args = {
      ...context,
      evaluatingArgument: true,
      expandedAt: context.expandedAt ?? context.registeredBy?.start ?? call.start,
    };
    for (const arg of call.arguments) this.visit(arg, args);
    return args.registration?.stoppedAt !== undefined;
  }

  private handle(call: CallExpression, api: ApiCall, context: Context): boolean {
    switch (api.kind) {
      case 'test':
        this.declareTest(call, api, context);
        return true;
      case 'describe':
        this.declareSuite(call, api, context);
        return true;
      case 'modifier': {
        if (context.test) context.test.problems.push(...api.problems.map((item) => this.here(item)));
        else for (const item of api.problems) this.report(item);
        if (api.condition.applies === 'never') return true;
        const own = api.condition.applies === 'sometimes' ? [api.condition.text as string] : [];
        const setting: StateSetting = {
          state: api.state,
          condition: joinConditions([...context.guards, ...own]),
          reason: api.reason,
          hasDynamicReason: api.hasDynamicReason,
          line: this.lineOf(call),
          afterLoad: context.test !== null || context.hookScope !== null,
        };
        if (context.helper) this.effectsOf(context.helper).push({ kind: 'state', setting, call });
        else (context.test ?? context.hookScope ?? context.scope).states.push(setting);
        return true;
      }
      case 'configure':
        for (const item of api.problems) this.report(item);
        if (context.helper) {
          this.effectsOf(context.helper).push({ kind: 'configure', mode: api.mode, locks: api.locks, call });
        } else if (!context.test && !context.hookScope) {
          configure(context.scope, api);
        }
        return true;
      case 'run':
        this.runSetting(call, api, context);
        return true;
      case 'step':
        // The adapters only return steps from test bodies.
        (context.test as PendingTest).steps.push({
          title: api.title.text,
          hasDynamicTitle: api.title.isDynamic,
          lineStart: this.lineOf(call),
          depth: context.stepDepth,
          isSkipped: api.isSkipped,
        });
        if (api.fn) this.visitCallback(api.fn, { ...context, stepDepth: context.stepDepth + 1 });
        return true;
      case 'hook':
        if (context.test) return false;
        if (context.registration?.stoppedAt !== undefined) return true;
        // A function with a name registers its hooks where it is called, not where it is written.
        if (!context.hookScope && context.declaredIn === null) {
          context.scope.hooks[api.name] += 1;
          if (EACH_HOOKS.has(api.name)) context.scope.hookFixtures.push(...api.fixtures);
          context.scope.setupFixtures.push(...api.fixtures);
          context.scope.takesAllFixtures ||= api.takesAllFixtures;
        }
        if (api.fn) {
          if (!call.arguments.includes(api.fn)) this.walkedAtCall.add(api.fn);
          this.visitCallback(api.fn, {
            ...context,
            hookScope: context.scope,
            registration: undefined,
            hookName: api.name,
            testContext: api.testContext,
            guards: [],
            helper: null,
          });
        }
        return true;
      case 'annotations':
        context.test?.annotations.push(...api.items);
        context.test?.problems.push(...api.problems.map((item) => this.here(item)));
        return true;
      case 'invalid': {
        this.stopRegistration(call, context);
        // Code that runs after the file loads, only when a condition holds, or in a function the scan can't place, which
        // runs only if something calls it, can't be sure to stop it loading.
        const afterLoad =
          context.test !== null ||
          context.hookScope !== null ||
          context.helper !== null ||
          context.declaredIn !== null ||
          context.calledIn !== null ||
          context.isInCondition;
        this.report({
          ...api.problem,
          afterLoad: afterLoad || context.registration !== undefined || api.problem.afterLoad,
          scope: context.scope,
        });
        // Under a condition, the call either never runs or fails the file, so it declares nothing either way.
        return api.declaration && !context.isInCondition ? this.handle(call, api.declaration, context) : true;
      }
      case 'other':
        return false;
    }
  }

  private effectsOf(fn: Node): Effect[] {
    const effects = this.effects.get(fn) ?? [];
    this.effects.set(fn, effects);
    return effects;
  }

  /** The function a name refers to when it is declared in the file, as a function or a variable holding one. */
  private functionNamed(name: string, scopes: readonly Node[]): FunctionNode | null {
    return this.functionIn(this.frame, name, scopes);
  }

  private functionIn(frame: Frame, name: string, scopes: readonly Node[]): FunctionNode | null {
    return frame.values.functionOf(name, scopes);
  }

  /**
   * Records a call to a function declared in the file. A call from the file or a describe returns the function, to be
   * walked there: its tests are registered in the describe around the call, and what it sets applies there. A call
   * from a test, a hook or another function is applied later, through the states the function sets.
   */
  private helperCall(call: CallExpression, context: Context): Callee | null {
    const callee = unwrap(call.callee);
    const runsHere = !context.test && !context.hookScope && !context.helper && this.callStack.length < MAX_DEPTH;
    if (
      runsHere &&
      (this.options.collectImports || context.registration) &&
      (callee.type === 'ArrowFunctionExpression' ||
        (callee.type === 'FunctionExpression' && (!callee.generator || context.registration)))
    )
      return this.withinLimit({ fn: callee, frame: this.frame }, call);
    if (callee.type === 'MemberExpression') {
      const object = unwrap(callee.object);
      const member = propertyName(callee);
      if (!runsHere || member === null) return null;
      let imported: Callee | null = null;
      if (object.type === 'Identifier') {
        imported = this.importedFunction(object.name, this.scopes, this.frame, member);
      } else {
        const source = requiredModule(object);
        if (source !== null && !this.frame.values.declarationOf('require', this.scopes))
          imported = this.functionFrom(this.frame, source, member);
      }
      return imported && !this.callStack.includes(imported.fn) ? this.withinLimit(imported, call) : null;
    }
    if (callee.type !== 'Identifier') return null;
    const fn = this.functionNamed(callee.name, this.scopes);
    if (!fn) {
      const imported = runsHere ? this.importedFunction(callee.name, this.scopes) : null;
      return imported && !this.callStack.includes(imported.fn) ? this.withinLimit(imported, call) : null;
    }
    const sites = this.callSites.get(fn) ?? new Map<Node, Placement>();
    if (!sites.has(call)) sites.set(call, this.placement(context));
    this.callSites.set(fn, sites);
    if (context.helper) {
      this.effectsOf(context.helper).push({ kind: 'call', fn, guards: context.guards });
    } else if (context.test || context.hookScope) {
      this.helperCalls.push({
        call,
        fn,
        target: context.test ?? (context.hookScope as Scope),
        hookName: context.test ? null : context.hookName,
        guards: context.guards,
      });
    } else if (context.declaredIn === null && !this.callStack.includes(fn) && this.callStack.length < MAX_DEPTH) {
      // From a describe in a function walked where it is written, the call only counts as one of the function's calls:
      // walking it there would depend on which of the two functions the file declares first.
      return this.withinLimit({ fn, frame: this.frame }, call);
    }
    return null;
  }

  /** The function to walk at a call, while the file has calls left to walk; past MAX_CALLS, the call is reported once. */
  private withinLimit(callee: Callee, call: CallExpression): Callee | null {
    if (this.callsWalked < MAX_CALLS) {
      this.callsWalked++;
      return callee;
    }
    if (this.callsWalked === MAX_CALLS) {
      this.callsWalked++;
      this.report(
        problem(
          'test-in-function',
          call,
          `The file's helper functions are called more than ${MAX_CALLS.toLocaleString('en-US')} times, counting the calls inside them, so the scan stops following them here. Tests they register from here on are missing, or listed once where they are written.`,
        ),
      );
    }
    return null;
  }

  /**
   * What a function declared in a file, the one being walked unless said otherwise, or imported from a local module,
   * returns; null otherwise. Each declaration is looked up once, however many calls use it.
   */
  private returnsOf(name: string, scopes: readonly Node[], frame = this.frame): Returns | null {
    const declaration = frame.values.declarationOf(name, scopes);
    if (declaration === null) return null;
    if (!this.returns.has(declaration)) {
      const local = this.functionIn(frame, name, scopes);
      const callee = local ? { fn: local, frame } : this.importedFunction(name, scopes, frame);
      this.returns.set(declaration, callee && this.returnsIn(callee));
    }
    return this.returns.get(declaration) ?? null;
  }

  private returnsIn({ fn, frame }: Callee): Returns {
    const scopes = [...this.scopeChain(fn, frame), fn];
    const values = returnValues(fn)?.map(({ expression, around }) => ({
      expression,
      scopes: [...scopes, ...around.filter(isScopeNode)],
    }));
    return {
      adapter: frame.adapter,
      values: values ?? null,
      returnsOf: (name, at) => this.returnsOf(name, at, frame),
    };
  }

  /**
   * The function a name imported from a local module stands for, in the file that writes it; null otherwise. With a
   * `member`, the function is that export of a module the name holds whole, as `checks.validatesQuantity` after
   * `import * as checks` or `const checks = require('./checks')`.
   */
  private importedFunction(
    name: string,
    scopes: readonly Node[],
    from = this.frame,
    member: string | null = null,
  ): Callee | null {
    const source = from.values.importSource(name, scopes);
    if (source === null) return null;
    const imported = from.values.importedName(name, scopes);
    const whole = imported === null || from.values.declarationOf(name, scopes)?.type === 'VariableDeclarator';
    const exported = member === null ? imported : whole ? member : null;
    return exported === null ? null : this.functionFrom(from, source, exported);
  }

  private functionFrom(from: Frame, source: string, name: string): Callee | null {
    const frame = this.openFrom(from, source);
    return frame ? this.exportedFunction(frame, name, new Set(), 0) : null;
  }

  /** A module a file imports, read as a frame once; null when it can't be read or parsed. */
  private openFrom(frame: Frame, source: string): Frame | null {
    const module = frame.readModule?.(source);
    if (!module || 'reason' in module) return null;
    if (!this.frames.has(module)) this.frames.set(module, this.openModule(module));
    return this.frames.get(module) ?? null;
  }

  /**
   * The function a module exports under a name, written there or re-exported from another module, as a barrel file
   * does; null when the export isn't a function the scan can find. Each module is searched once for a name, however many
   * barrels lead to it: one searched before didn't have it, or the search would have ended there.
   */
  private exportedFunction(frame: Frame, name: string, searched: Set<string>, depth: number): Callee | null {
    const key = `${frame.relativeFilePath}\0${name}`;
    if (searched.has(key) || depth >= MAX_DEPTH) return null;
    searched.add(key);
    const { program } = frame.parsed;
    const from = (source: string, exported: string): Callee | null => {
      const module = this.openFrom(frame, source);
      return module ? this.exportedFunction(module, exported, searched, depth + 1) : null;
    };
    const local = (localName: string): Callee | null => {
      const fn = this.functionIn(frame, localName, [program]);
      if (fn) return { fn, frame };
      // A name the module imports and exports again, as `import helper from './a'; export { helper }`.
      const source = frame.values.importSource(localName, [program]);
      return source === null ? null : from(source, frame.values.importedName(localName, [program]) as string);
    };
    for (const statement of program.body) {
      if (statement.type === 'ExportDefaultDeclaration' && name === 'default') {
        const declaration = statement.declaration;
        if (declaration.type === 'FunctionDeclaration' || isFunctionNode(declaration))
          return { fn: declaration, frame };
        return declaration.type === 'Identifier' ? local(declaration.name) : null;
      }
      if (statement.type === 'ExportAllDeclaration' && !statement.exported) {
        const found = from(statement.source.value, name);
        if (found) return found;
      }
      if (statement.type !== 'ExportNamedDeclaration') continue;
      const declaration = statement.declaration;
      if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name === name)
        return { fn: declaration, frame };
      if (declaration?.type === 'VariableDeclaration') {
        const declarator = declaration.declarations.find(
          (item) => item.id.type === 'Identifier' && item.id.name === name,
        );
        if (declarator) return local(name);
      }
      const specifier = statement.specifiers.find((item) => exportName(item.exported) === name);
      if (specifier) {
        const localName = exportName(specifier.local);
        return statement.source ? from(statement.source.value, localName) : local(localName);
      }
    }
    // A CommonJS module: `module.exports = { registerSettlement }` or `exports.registerSettlement = function () {}`.
    const commonJs = commonJsExport(program, name);
    const value = commonJs ? unwrap(commonJs) : null;
    if (value?.type === 'Identifier') return local(value.name);
    return isFunctionNode(value) ? { fn: value, frame } : null;
  }

  /**
   * Walks a function at one of its calls from the file or a describe, as the runner runs it there: with the scopes
   * where it is written, and its parameters bound to the call's arguments so that titles built from them resolve. A
   * function imported from another module is walked in that module, and what it registers points at this call.
   */
  private walkAtCall({ fn, frame }: Callee, call: CallExpression, context: Context, registering: boolean): void {
    this.walkedAtCall.add(fn);
    // Arguments are worked out where the call is, in the file and scopes of the caller.
    const args: Resolved[] = [];
    let complete = true;
    for (const item of call.arguments) {
      if (item.type !== 'SpreadElement') {
        args.push(this.frame.values.resolve(item, this.scopes));
        continue;
      }
      const list = registering && this.frame.values.resolve(item.argument, this.scopes);
      if (!list || !list.ok || !(Array.isArray(list.value) || typeof list.value === 'string')) {
        complete = false;
        break;
      }
      for (const value of list.value) args.push({ ok: true, value });
    }
    const parameterSteps = registering ? new Map<Node, ParameterStep>() : undefined;
    const caller = this.frame;
    const site = this.site;
    if (frame !== caller) {
      this.frame = frame;
      this.site ??= call;
    }
    const scopes = this.scopeChain(fn);
    const saved = this.scopes.splice(0, this.scopes.length, ...scopes);
    this.callStack.push(fn);
    frame.values.withArguments(
      fn,
      args,
      scopes,
      () => {
        const visitBody = (registration: Context['registration']) => {
          this.visitCallback(
            fn,
            {
              ...context,
              registration,
              isInFunction: true,
              declaredIn: null,
              calledIn: context.declaredIn ? { fn: context.declaredIn, call } : context.calledIn,
              registeredBy: context.registeredBy ?? call,
            },
            parameterSteps,
          );
        };
        if (registering && context.registration && fn.async && !fn.generator)
          this.asyncRegistration(context.registration, fn.body as Node, visitBody);
        else visitBody(context.registration);
      },
      complete,
      parameterSteps,
    );
    this.callStack.pop();
    this.scopes.splice(0, this.scopes.length, ...saved);
    // What the module's own imports couldn't resolve is reported at the call, as it is why tests may be missing. Another
    // runner's module it imports matters only to a function that uses it: a module of shared helpers may import one.
    if (frame !== caller) {
      for (const item of frame.adapter.problems.filter((found) => !this.moduleProblems.has(found))) {
        if (item.code === 'framework-mismatch' && !usesImport(fn, frame.parsed.program, item.node as Span)) continue;
        this.moduleProblems.add(item);
        this.report(item);
      }
    }
    this.frame = caller;
    this.site = site;
  }

  /**
   * Walks a deferred function where it is written. One that was walked at its calls only collects the states it sets,
   * for calls from tests and hooks; one that wasn't records its tests where they are written, as nothing places them.
   */
  private walkWhereWritten({ fn, context, scopes, parents }: Deferred): void {
    const savedScopes = this.scopes.splice(0, this.scopes.length, ...scopes);
    const savedParents = this.parents.splice(0, this.parents.length, ...parents);
    this.visitChildren(fn, {
      ...context,
      isInFunction: true,
      helper: fn,
      guards: [],
      declaredIn: fn,
      registration: undefined,
      quiet: this.walkedAtCall.has(fn),
    });
    this.scopes.splice(0, this.scopes.length, ...savedScopes);
    this.parents.splice(0, this.parents.length, ...savedParents);
  }

  /** The scopes around a function where it is written, outermost first, to resolve names in it at its calls. */
  private scopeChain(fn: Node, frame = this.frame): Node[] {
    const { program } = frame.parsed;
    let chains = this.scopeChains.get(program);
    if (!chains) {
      const found = new Map<Node, Node[]>();
      const around: Node[] = [];
      const visit = (node: Node) => {
        if (node.type === 'FunctionDeclaration' || isFunctionNode(node)) found.set(node, [...around]);
        const isScope = isScopeNode(node);
        if (isScope) around.push(node);
        for (const child of childNodes(node)) visit(child);
        if (isScope) around.pop();
      };
      visit(program);
      chains = found;
      this.scopeChains.set(program, chains);
    }
    return chains.get(fn) as Node[];
  }

  /**
   * Applies `test.setTimeout()` or `test.slow()` where it is called: in a test body to the test, in a `beforeEach` to
   * the tests of its scope, at file or describe level to the scope. A function with a name applies them where it is
   * called instead.
   */
  private runSetting(call: CallExpression, api: Extract<ApiCall, { kind: 'run' }>, context: Context): void {
    if (api.fileWide) {
      for (const item of api.problems) this.report(item);
      // Called by a function or while tests run, it changes only the tests that run after it.
      if (context.declaredIn !== null || context.test || context.hookScope) return;
      const { settings, problems } = this.guardedRun(call, api.settings, api.argument, context.guards);
      for (const item of problems) this.report(item);
      mergeRun(this.fileScope.details.run, settings);
      return;
    }
    if (context.declaredIn !== null && !context.test) {
      for (const item of api.problems) this.report(item);
      if (context.helper)
        this.effectsOf(context.helper).push({ kind: 'run', settings: api.settings, argument: api.argument, call });
      return;
    }
    const { settings, problems } = this.guardedRun(call, api.settings, api.argument, context.guards);
    problems.unshift(...api.problems);
    if (context.test) {
      context.test.problems.push(...problems.map((item) => this.here(item)));
      mergeRun(context.test.run, settings);
      return;
    }
    for (const item of problems) this.report(item);
    if (context.hookScope) {
      // `beforeAll` and `afterAll` set the hook's own timeout, and an `afterEach` runs after the test body.
      if (context.hookName === 'beforeEach') mergeRun(context.hookScope.hookRun, settings);
      return;
    }
    mergeRun(context.scope.details.run, settings);
  }

  /**
   * Run settings under the conditions around a call: a slow test keeps them as its condition, while a timeout set only
   * sometimes is left out with a warning.
   */
  private guardedRun(
    call: CallExpression,
    written: RunSettings,
    argument: string | null,
    guards: string[],
  ): { settings: RunSettings; problems: Problem[] } {
    const settings = { ...written };
    const problems: Problem[] = [];
    const guard = joinConditions(guards);
    if (settings.slow && guards.length > 0) {
      const own = settings.slow.conditions ?? [null];
      settings.slow = {
        conditions: own.map(
          (condition) => joinConditions([...guards, ...(condition === null ? [] : [condition])]) as string,
        ),
      };
    }
    const unapplied = (key: string) => {
      const message = `Option ${key}: ${argument as string} is set only when ${guard as string}; it is not applied.`;
      problems.push(problem('unresolved-option', call, message, snippet(this.text(call))));
    };
    if (settings.timeout !== undefined && guard !== null) {
      unapplied('timeout');
      delete settings.timeout;
    }
    if (settings.retry !== undefined && guard !== null) {
      unapplied('retry');
      delete settings.retry;
    }
    return { settings, problems };
  }

  /** Run settings a helper sets when a test body or a `beforeEach` calls it, under the conditions around the call. */
  private applyHelperRun(call: HelperCall, effect: Extract<Effect, { kind: 'run' }> & { guards: string[] }): void {
    const { settings, problems } = this.guardedRun(call.call, effect.settings, effect.argument, effect.guards);
    if (call.hookName === null) {
      const test = call.target as PendingTest;
      test.problems.push(...problems);
      mergeRun(test.run, settings);
    } else if (call.hookName === 'beforeEach') {
      this.problems.push(...problems);
      mergeRun((call.target as Scope).hookRun, settings);
    }
  }

  /**
   * Counts `expect()`, `expect.soft()`, `expect.poll()` and `expect.element()`, and reads `expect.assertions(n)` and
   * `expect.hasAssertions()`.
   */
  private expectCall(call: CallExpression, test: PendingTest): void {
    const callee = unwrap(call.callee);
    const [root, member] =
      callee.type === 'MemberExpression' ? [unwrap(callee.object), propertyName(callee)] : [callee, 'call'];
    if (!this.isExpect(root)) return;
    if (member === 'call' || member === 'soft' || member === 'poll' || member === 'element') test.expectCount += 1;
    if (member === 'hasAssertions') test.expectsAssertions = true;
    const count = call.arguments.at(0);
    if (member === 'assertions' && count && count.type !== 'SpreadElement') {
      const file = { source: this.frame.parsed.source, values: this.frame.values, version: null };
      const option = { node: count, resolved: this.frame.values.resolve(count, this.scopes) };
      const problems: Problem[] = [];
      test.expectedAssertions = readCount(file, 'expect.assertions', option, problems);
      test.problems.push(...problems.map((item) => this.here(item)));
    }
  }

  /**
   * Whether an expression is `expect`, or Playwright's `expect.configure(...)`, which gives an `expect` with other
   * defaults, written in place or kept in a variable.
   */
  private isExpect(expression: Expression): boolean {
    const node = unwrap(expression);
    if (node.type === 'Identifier') {
      if (node.name === 'expect') return true;
      const declaration = this.frame.values.declarationOf(node.name, this.scopes);
      return declaration?.type === 'VariableDeclarator' && declaration.init !== null && isConfigured(declaration.init);
    }
    return isConfigured(node);
  }

  /** Reports a problem not tied to a test, once, however many times a function with it is walked. */
  private report(found: Problem): void {
    const item = this.here(found);
    // Problems found in code point at it.
    const key = `${item.code}\0${(item.node as Span).start}\0${item.message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.problems.push(item);
  }

  /** A problem found in an imported helper points at the call in the scanned file that walks the helper. */
  private here(item: Problem): Problem {
    return this.site ? { ...item, node: this.site } : item;
  }

  /** The line in the scanned file of code being walked: its own, or that of the call walking an imported helper. */
  private lineOf(node: Span): number {
    return this.main.parsed.source.line((this.site ?? node).start);
  }

  /** Where an imported helper writes a test or describe; null for code in the scanned file. */
  private declaredAt(call: CallExpression): DeclaredAt | null {
    if (!this.site) return null;
    return { relativeFilePath: this.frame.relativeFilePath, source: this.frame.parsed.source, start: call.start };
  }

  /** Leaves a test or describe out of the describe's body hash, when both are written in the same file. */
  private cut(scope: Scope, call: CallExpression): void {
    if (scope.suite && this.suiteFrames.get(scope.suite) === this.frame) scope.suite.cuts.push(this.statement(call));
  }

  /** Functions the file exports, whose callers in other files are not followed. */
  private exportedFunctions(program: Program): Set<Node> {
    const exported = new Set<Node>();
    const add = (name: string) => {
      const fn = this.functionNamed(name, [program]);
      if (fn) exported.add(fn);
    };
    for (const statement of program.body) {
      if (statement.type === 'ExportDefaultDeclaration') exported.add(statement.declaration);
      if (statement.type !== 'ExportNamedDeclaration') continue;
      const declaration = statement.declaration;
      if (declaration?.type === 'FunctionDeclaration' && declaration.id) add(declaration.id.name);
      if (declaration?.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === 'Identifier') add(declarator.id.name);
        }
      }
      if (!statement.source) for (const specifier of statement.specifiers) add(exportName(specifier.local));
    }
    return exported;
  }

  /**
   * Applies what helper functions set to the tests, hooks and describes that call them, through nested helpers too,
   * with the conditions around each call. A helper no test or hook reaches, or that the file exports, is reported.
   */
  private applyHelpers(exported: Set<Node>): void {
    const reached = new Set<Node>();
    // For one call from a test or hook: the conditions each helper was expanded under, and how many expansions it took.
    let expanded = new Map<Node, Set<string>>();
    let steps = 0;
    type Expanded =
      Exclude<Effect, { kind: 'call' | 'run' }> | (Extract<Effect, { kind: 'run' }> & { guards: string[] });
    const expand = (fn: Node, guards: string[], path: Set<Node>): Expanded[] => {
      if (path.has(fn) || exported.has(fn)) return [];
      // A helper reached again under the same conditions sets the same states again.
      const conditions = expanded.get(fn) ?? new Set<string>();
      const key = guards.join('\0');
      if (conditions.has(key) || ++steps > MAX_CALLS) return [];
      expanded.set(fn, conditions.add(key));
      reached.add(fn);
      return (this.effects.get(fn) ?? []).flatMap((effect) => {
        if (effect.kind === 'call') return expand(effect.fn, [...guards, ...effect.guards], new Set([...path, fn]));
        if (effect.kind === 'configure') return [effect];
        if (effect.kind === 'run') return [{ ...effect, guards }];
        const condition = joinConditions([...guards, ...(effect.setting.condition ? [effect.setting.condition] : [])]);
        // Helpers are expanded here only for calls from tests and hooks.
        return [{ ...effect, setting: { ...effect.setting, condition, afterLoad: true } }];
      });
    };
    for (const call of this.helperCalls) {
      expanded = new Map();
      steps = 0;
      for (const effect of expand(call.fn, call.guards, new Set())) {
        // `describe.configure()` does nothing in a test or hook body.
        if (effect.kind === 'state') call.target.states.push(effect.setting);
        if (effect.kind === 'run') this.applyHelperRun(call, effect);
      }
      if (steps > MAX_CALLS) {
        const callee = snippet(this.frame.parsed.source.slice(call.call.callee.start, call.call.callee.end));
        this.problems.push(
          problem(
            'state-in-helper',
            call.call,
            `${callee}() calls helper functions more than ${MAX_CALLS.toLocaleString('en-US')} times, counting the calls inside them, so the states they set past that are not applied.`,
            callee,
          ),
        );
      }
    }
    for (const [fn, effects] of this.effects) {
      const own = effects.find((effect) => effect.kind !== 'call');
      if (!own || ((reached.has(fn) || this.walkedAtCall.has(fn)) && !exported.has(fn))) continue;
      const callee = snippet(this.frame.parsed.source.slice(own.call.callee.start, own.call.callee.end));
      const why = exported.has(fn) ? 'is exported' : 'no test, hook or describe in the file calls';
      this.problems.push(
        problem(
          'state-in-helper',
          own.call,
          `${callee}() is in a function that ${why}; it applies to the tests that call the function, so it is not applied here.`,
          callee,
        ),
      );
    }
  }

  /** Why calling a function with a name doesn't register its tests where they are written; null when it does. */
  private misplaced(fn: Node, exported: Set<Node>): string | null {
    if (exported.has(fn)) return 'the file exports the function';
    const sites = [...(this.callSites.get(fn)?.values() ?? [])];
    if (sites.length === 0) return 'nothing in the file calls the function by name';
    if (sites.length > 1) return `the function is called ${sites.length} times`;
    const written = this.written.get(fn) as Written;
    return calledWhereWritten(sites[0], written)
      ? null
      : 'the function is called in another place than where it is written';
  }

  /**
   * Warns about tests declared in a function with a name, or in one around it, whose calls register them somewhere
   * else than where they are written: the runner adds a test to the describe around each call.
   */
  private checkFunctionTests(exported: Set<Node>): void {
    for (const [test, { fn: innermost, call }] of this.declaredIn) {
      let why: string | null = null;
      for (let fn: Node | null = innermost; fn && !why; fn = (this.written.get(fn) as Written).declaredIn) {
        why = this.misplaced(fn, exported);
      }
      if (!why) continue;
      const registers = 'The runner registers the test at each call of the function, in the describe around the call';
      if (call) {
        const helper = `${snippet(this.main.parsed.source.slice(call.callee.start, call.callee.end))}()`;
        test.problems.push(
          problem(
            'test-in-function',
            test.site,
            `The test is registered by ${helper} in a function, and ${why}. ${registers}; it is listed where ${helper} is called.`,
          ),
        );
        continue;
      }
      test.problems.push(
        problem(
          'test-in-function',
          test.call,
          `The test is declared in a function, and ${why}. ${registers}; it is listed once, where it is written.`,
        ),
      );
    }
  }

  private nested(call: CallExpression, context: Context, isTest: boolean): boolean {
    if (!context.test && !context.hookScope) return false;
    const inTest = context.test !== null && !context.hookScope && this.frame.adapter.nestsTests === true;
    if (isTest && inTest) return false;
    const message = inTest
      ? 'A describe declared inside a test body runs as a nested describe of the test, but the scan does not list it or its tests.'
      : 'A test or describe declared inside a test or hook body is not collected by the runner, so it is not listed.';
    this.report(problem('nested-test', call, message, snippet(this.frame.parsed.source.slice(call.start, call.end))));
    return true;
  }

  private declareTest(call: CallExpression, declaration: TestDeclaration, context: Context): void {
    if (context.quiet || this.nested(call, context, true)) return;
    for (const item of this.cases(declaration, call, context)) this.declareCase(call, item, context);
  }

  /**
   * With `expandCases`, a declaration for each case of its table, with the case's title and the arguments its callback
   * gets; otherwise, or when the scan can't give each case its title, the declaration alone, with a problem that says
   * why.
   */
  private cases<T extends TestDeclaration | SuiteDeclaration>(
    declaration: T,
    call: CallExpression,
    context: Context,
  ): Case<T>[] {
    const single = (reason: string | null): Case<T>[] => {
      if (reason === null) return [{ declaration, index: null, args: null }];
      const item = problem(
        'cases-not-expanded',
        call,
        `The cases of the table are listed as one record, since ${reason}.`,
      );
      return [{ declaration: { ...declaration, problems: [...declaration.problems, item] }, index: null, args: null }];
    };
    if (!this.options.expandCases || !declaration.isParameterized || declaration.caseCount === null)
      return single(null);
    if (!declaration.cases) return single("the scan can't work out every value in it");
    const title = declaration.title;
    if (!title || title.isDynamic) return single("the scan can't work out the title");
    const titles = declaration.cases.map((item) => item.title);
    const problemTitle = titles.find((text) => text !== null && typeof text === 'object');
    if (problemTitle) return single(problemTitle.reason);
    if (titles.some((text) => text === null)) {
      return single("the title shows a value the scan doesn't format the way the runner does");
    }
    if (declaration.kind === 'describe' && this.expands(null, declaration.cases, context) === 'limit') {
      return single(
        `expanding it would take the file past ${MAX_EXPANDED.toLocaleString('en-US')} loop passes and describe cases`,
      );
    }
    return declaration.cases.map((item, index) => ({
      declaration: {
        ...declaration,
        title: { text: titles[index] as string, withoutTags: titles[index] as string, isDynamic: false },
        caseCount: 1,
      },
      index,
      args: item.args.map((value): Resolved => ({ ok: true, value })),
    }));
  }

  private declareCase(
    call: CallExpression,
    { declaration, index, args }: Case<TestDeclaration>,
    context: Context,
  ): void {
    const registrationStoppedAt = context.registration?.stoppedAt ?? context.emptySuiteAt;
    if (registrationStoppedAt !== undefined && declaration.isOnly) declaration = { ...declaration, isOnly: false };
    const statement = this.statement(call);
    const empty = emptyTitle(declaration, call);
    const test: PendingTest = {
      registrationStoppedAt,
      scope: context.scope,
      parent: context.test,
      declaration,
      call,
      site: this.site,
      declaredAt: this.declaredAt(call),
      frame: this.frame,
      registeredBy: context.registeredBy,
      order: context.expandedAt ?? context.registeredBy?.start ?? call.start,
      states: [...declaration.states],
      annotations: [...declaration.details.annotations],
      isInLoop: context.isInLoop,
      // A condition inside a loop decides on each pass whether the test is registered.
      passes: context.loops,
      loops: context.loops.map((passes, index) =>
        context.isInCondition && !context.loopConditions[index] ? null : passes,
      ),
      isInCondition: context.isInCondition,
      isInFunction: context.isInFunction,
      caseIndex: index ?? context.caseIndex,
      comments: this.commentsAbove(statement.start),
      run: {},
      expectCount: 0,
      expectedAssertions: null,
      expectsAssertions: false,
      steps: [],
      problems: [...declaration.problems, ...empty].map((item) => this.here(item)),
    };
    this.tests.push(test);
    const placedBy = context.declaredIn ? { fn: context.declaredIn, call: null } : context.calledIn;
    if (placedBy) this.declaredIn.set(test, placedBy);
    this.cut(context.scope, call);
    // A function declared in the file and passed by name runs as the test body too.
    this.withDeclarationBody(declaration, call, (body) => {
      this.withCase(body, args, () => {
        this.visitCallback(body, {
          ...context,
          test,
          registration: undefined,
          hookScope: null,
          hookName: null,
          stepDepth: 0,
          testContext: declaration.testContext,
          guards: [],
          helper: null,
        });
      });
    });
  }

  /** Named callbacks keep their lexical scopes and use the same traversal bounds as directly called helpers. */
  private withDeclarationBody(
    declaration: TestDeclaration | SuiteDeclaration,
    call: CallExpression,
    walk: (fn: FunctionNode) => void,
  ): void {
    const fn = declaration.fn ?? declaration.hashed;
    if (!fn) return;
    if (declaration.fn) {
      walk(fn);
      return;
    }
    this.walkedAtCall.add(fn);
    if (this.callStack.includes(fn) || this.callStack.length >= MAX_DEPTH) {
      this.report(
        problem(
          'test-in-function',
          call,
          'The named callback recurses or exceeds the helper depth limit, so its nested tests are not followed here.',
        ),
      );
      return;
    }
    if (!this.withinLimit({ fn, frame: this.frame }, call)) return;
    const saved = this.scopes.splice(0, this.scopes.length, ...this.scopeChain(fn));
    this.callStack.push(fn);
    walk(fn);
    this.callStack.pop();
    this.scopes.splice(0, this.scopes.length, ...saved);
  }

  /** Runs `walk` with a case's arguments bound to the parameters of its callback, as the runner calls it. */
  private withCase(fn: FunctionNode, args: Resolved[] | null, walk: () => void): void {
    if (args) this.frame.values.withArguments(fn, args, this.scopes, walk);
    else walk();
  }

  private declareSuite(call: CallExpression, declaration: SuiteDeclaration, context: Context): void {
    if (context.quiet || this.nested(call, context, false)) return;
    for (const item of this.cases(declaration, call, context)) this.declareSuiteCase(call, item, context);
  }

  private declareSuiteCase(
    call: CallExpression,
    { declaration, index, args }: Case<SuiteDeclaration>,
    context: Context,
  ): void {
    if ((context.registration?.stoppedAt !== undefined || context.emptySuiteAt !== undefined) && declaration.isOnly)
      declaration = { ...declaration, isOnly: false };
    for (const item of [...declaration.problems, ...emptyTitle(declaration, call)]) this.report(item);
    const scope: Scope = {
      kind: 'describe',
      parent: context.scope,
      states: [...declaration.states],
      mode: declaration.mode,
      isOnly: declaration.isOnly,
      details: declaration.details,
      hooks: noHooks(),
      hookRun: {},
      hookFixtures: [],
      setupFixtures: [],
      takesAllFixtures: false,
      suite: null,
    };
    const suite: PendingSuite = {
      scope,
      declaration,
      call,
      site: this.site,
      declaredAt: this.declaredAt(call),
      frame: this.frame,
      registeredBy: context.registeredBy,
      order: context.expandedAt ?? context.registeredBy?.start ?? call.start,
      cuts: [],
      isInCondition: context.isInCondition,
      isInFunction: context.isInFunction,
      caseIndex: index ?? context.caseIndex,
    };
    scope.suite = suite;
    this.suites.push(suite);
    this.cut(context.scope, call);
    this.suiteFrames.set(suite, this.frame);
    this.withDeclarationBody(declaration, call, (fn) => {
      this.withCase(fn, args, () => {
        this.visitCallback(fn, {
          ...context,
          scope,
          registration: this.frame.adapter.catchesSuiteErrors
            ? { stoppedAt: context.registration?.stoppedAt }
            : undefined,
          emptySuiteAt: context.emptySuiteAt ?? (declaration.emptySuiteError ? this.lineOf(call) : undefined),
          handlesRegistrationError: false,
          test: null,
          hookScope: null,
          hookName: null,
          stepDepth: 0,
          testContext: null,
          guards: [],
          helper: null,
          // The pass of a loop around the describe is the describe's, not that of each test in it.
          caseIndex: null,
          isExpanding: context.isExpanding || index !== null,
          expandedAt: this.expandedAt(context, index === null ? null : call.start),
        });
      });
    });
    const error = declaration.emptySuiteError;
    if (error) {
      this.report({ ...error.problem, afterLoad: true, scope: context.scope });
      if (context.registration && !context.skipImports && context.registration.stoppedAt === undefined) {
        context.registration.stoppedAt = this.lineOf(call);
        if (error.keepsScope) context.registration.recoveryScope = scope;
      }
    }
  }

  /** The statement a call forms, such as `test(...);`, or the call itself when it is part of a larger expression. */
  private statement(call: CallExpression): Span {
    const parent = this.parents.at(-2);
    return parent?.type === 'ExpressionStatement' ? parent : call;
  }

  /** Comment lines on the lines directly above a statement, with no blank line in between. */
  private commentsAbove(start: number): string[] {
    const { comments, source } = this.frame.parsed;
    const lines: string[] = [];
    let next = start;
    // Comments are in source order; find the last one that ends before the statement.
    let low = 0;
    let high = comments.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (comments[middle].end <= start) low = middle + 1;
      else high = middle;
    }
    for (let index = low - 1; index >= 0; index--) {
      const comment = comments[index];
      if (!source.startsLine(comment.start) || !source.isAdjacent(comment.end, next)) break;
      lines.unshift(...commentLines(comment));
      next = comment.start;
    }
    return lines;
  }
}

/** Walks the scanned file; `openModule` reads the modules of imported helpers that the file calls. */
export function extract(
  main: Frame,
  openModule: OpenModule,
  options: ExtractOptions = { expandCases: false, version: null },
): Extraction {
  return new Walker(main, openModule, options).run();
}

/** Whether an expression is a call of `expect.configure()`. */
function isConfigured(expression: Expression): boolean {
  const node = unwrap(expression);
  const callee = node.type === 'CallExpression' ? unwrap(node.callee) : null;
  if (callee?.type !== 'MemberExpression' || propertyName(callee) !== 'configure') return false;
  const object = unwrap(callee.object);
  return object.type === 'Identifier' && object.name === 'expect';
}

/**
 * Whether a function uses a name that the import at `at` in the program binds. A framework-mismatch problem is on an
 * import declaration, on one of its specifiers when the name comes from another module that imports the runner, or on
 * a `require()` declarator.
 */
function usesImport(fn: FunctionNode, program: Program, at: Span): boolean {
  const find = (node: Node): Node | undefined =>
    node.start === at.start && node.end === at.end
      ? node
      : childNodes(node)
          .filter((child) => child.start <= at.start && at.end <= child.end)
          .map(find)
          .find((found) => found !== undefined);
  const node = program.body.map(find).find((found) => found !== undefined) as
    ImportDeclaration | ImportDeclarationSpecifier | VariableDeclarator;
  const names = new Set(
    node.type === 'ImportDeclaration'
      ? node.specifiers.map((specifier) => specifier.local.name)
      : node.type === 'VariableDeclarator'
        ? bindingNames(node.id)
        : [node.local.name],
  );
  const uses = (node: Node): boolean =>
    (node.type === 'Identifier' && names.has(node.name)) || childNodes(node).some(uses);
  return uses(fn.body as Node);
}
