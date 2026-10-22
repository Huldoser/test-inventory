import type { CallExpression, CatchClause, Expression, Node, Program } from 'oxc-parser';
import {
  childNodes,
  isFunctionNode,
  isImportMetaVitest,
  propertyName,
  returnValues,
  unwrap,
  type FunctionNode,
} from './ast.ts';
import { exportName } from './frameworks/bindings.ts';
import { problem } from './frameworks/common.ts';
import type {
  Adapter,
  ApiCall,
  Details,
  Mode,
  ModuleReader,
  ModuleSource,
  Problem,
  Returns,
  Span,
  StateSetting,
  SuiteDeclaration,
  TestDeclaration,
} from './model.ts';
import type { ParsedFile } from './parse.ts';
import { snippet, splitLines, type SourceText } from './source.ts';
import type { Annotation, HookCounts } from './types.ts';
import { isScopeNode, type Values } from './values.ts';

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
  /** Where the scanned file registers the describe: its own call, or the outermost helper call that declares it. */
  order: number;
  /** Statements of the tests and describes directly inside, left out of the describe's body hash. */
  cuts: Span[];
}

export interface PendingTest {
  scope: Scope;
  declaration: TestDeclaration;
  call: CallExpression;
  /** For a test declared in an imported helper, the call in the scanned file that registers it; null otherwise. */
  site: Span | null;
  declaredAt: DeclaredAt | null;
  /** Where the scanned file registers the test: its own call, or the outermost helper call that declares it. */
  order: number;
  /** States from the declaration, then from calls in the body such as `test.skip(condition)`. */
  states: StateSetting[];
  annotations: Annotation[];
  isInLoop: boolean;
  isInCondition: boolean;
  isInFunction: boolean;
  comments: string[];
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

/** Reads a module a helper is imported from as a frame; null when it can't be parsed. */
export type OpenModule = (module: ModuleSource) => Frame | null;

/** A function walked at a call, and the file it is written in. */
interface Callee {
  fn: FunctionNode;
  frame: Frame;
}

export interface Extraction {
  suites: PendingSuite[];
  tests: PendingTest[];
  /** Problems not tied to one test. */
  problems: Problem[];
  /** Hooks at the top level of the file. */
  hooks: HookCounts;
  usesGlobals: boolean;
}

interface Context {
  scope: Scope;
  test: PendingTest | null;
  /** The scope a hook body applies to, while in a hook. */
  hookScope: Scope | null;
  /** The framework's names for the current test or hook context, such as Vitest's `context.skip`. */
  testContext: unknown;
  /** Source text of the conditions around a call (`if`, `?:`, logical operators, `switch`) within the current body. */
  guards: string[];
  isInLoop: boolean;
  isInCondition: boolean;
  isInFunction: boolean;
  /** The plain function being walked outside any test or hook, whose states apply to the code that calls it. */
  helper: Node | null;
  /** The innermost function with a name being walked outside any test or hook; calling it registers its tests. */
  declaredIn: Node | null;
  /**
   * Set while a function is walked where it is written although it is also walked at its calls: only the states it sets
   * are collected, for calls from tests and hooks, and its tests and describes are not recorded again.
   */
  quiet: boolean;
  /** The start of the outermost helper call being walked from the file or a describe; null outside one. */
  registeredAt: number | null;
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
  | { kind: 'call'; fn: Node; guards: string[] };

/** A call to a helper function from a test or a hook, whose states apply to that test or the tests the hook covers. */
interface HelperCall {
  call: CallExpression;
  fn: Node;
  target: PendingTest | Scope;
  guards: string[];
}

const LOOP_METHODS = new Set(['forEach', 'map']);

/** What `test.describe.configure()` sets on the describe or file it is called in: the last mode wins, locks add up. */
function configure(scope: Scope, settings: { mode: Mode | null; locks: string[] }): void {
  if (settings.mode) scope.mode = settings.mode;
  scope.details.locks.push(...settings.locks);
}

/** Joins conditions with `&&`, adding parentheses where a part could otherwise be read differently. */
export function noHooks(): HookCounts {
  return { beforeAll: 0, beforeEach: 0, afterEach: 0, afterAll: 0, aroundEach: 0, aroundAll: 0 };
}

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
  private site: CallExpression | null = null;
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
  /** The function with a name each test is declared in, which registers the test when it is called. */
  private readonly declaredIn = new Map<PendingTest, Node>();
  private readonly deferred: Deferred[] = [];
  private readonly isDeferred = new Set<Node>();
  /** Functions walked at one of their calls, so that their tests are recorded where they are registered. */
  private readonly walkedAtCall = new Set<Node>();
  /** The functions being walked at their calls, innermost last, to stop recursion. */
  private readonly callStack: Node[] = [];
  /** Helper calls walked in the file so far, up to MAX_CALLS. */
  private callsWalked = 0;
  /** Problems already reported, since a function walked at several calls finds the same ones each time. */
  private readonly reported = new Set<string>();
  /** What the functions named in calls such as `onNode(22)('title', fn)` return, by the declaration of each name. */
  private readonly returns = new Map<Node, Returns | null>();
  /** For each file's program, the scopes around each function in it. */
  private readonly scopeChains = new Map<Node, Map<Node, Node[]>>();

  constructor(main: Frame, openModule: OpenModule) {
    this.main = main;
    this.frame = main;
    this.openModule = openModule;
    const { adapter } = main;
    this.fileScope = {
      kind: 'file',
      parent: null,
      states: [],
      mode: null,
      isOnly: false,
      details: { tags: adapter.fileTags, annotations: [], locks: [], meta: null },
      hooks: noHooks(),
      suite: null,
    };
  }

  run(): Extraction {
    this.visit(this.main.parsed.program, {
      scope: this.fileScope,
      test: null,
      hookScope: null,
      testContext: null,
      guards: [],
      isInLoop: false,
      isInCondition: false,
      isInFunction: false,
      helper: null,
      declaredIn: null,
      quiet: false,
      registeredAt: null,
    });
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
      tests: this.tests,
      problems: [...this.main.adapter.problems, ...this.problems],
      hooks: this.fileScope.hooks,
      usesGlobals: this.main.adapter.usesGlobals,
    };
  }

  private visit(node: Node, context: Context): void {
    const isScope = isScopeNode(node);
    if (isScope) this.scopes.push(node);
    this.parents.push(node);
    this.visitNode(node, context);
    this.parents.pop();
    if (isScope) this.scopes.pop();
  }

  private visitChildren(node: Node, context: Context): void {
    for (const child of childNodes(node)) this.visit(child, context);
  }

  private visitNode(node: Node, context: Context): void {
    switch (node.type) {
      case 'CallExpression': {
        const helper = this.helperCall(node, context);
        if (this.call(node, context) || this.loopCall(node, context)) return;
        this.visitChildren(node, context);
        if (helper) this.walkAtCall(helper, node, context);
        return;
      }
      case 'IfStatement': {
        // In-source tests sit inside `if (import.meta.vitest)`, which is how they are written, not a condition.
        if (isImportMetaVitest(node.test)) break;
        const condition = this.text(node.test);
        this.visit(node.test, context);
        this.visit(node.consequent, this.guarded(context, condition));
        if (node.alternate) this.visit(node.alternate, this.guarded(context, `!(${condition})`));
        return;
      }
      case 'ConditionalExpression': {
        const condition = this.text(node.test);
        this.visit(node.test, context);
        this.visit(node.consequent, this.guarded(context, condition));
        this.visit(node.alternate, this.guarded(context, `!(${condition})`));
        return;
      }
      case 'LogicalExpression': {
        const left = this.text(node.left);
        const guard = node.operator === '&&' ? left : node.operator === '||' ? `!(${left})` : `(${left}) == null`;
        this.visit(node.left, context);
        this.visit(node.right, this.guarded(context, guard));
        return;
      }
      case 'TryStatement':
        this.visit(node.block, context);
        // A `catch` block runs only when the `try` block throws, as when a test server can't start.
        if (node.handler) this.visit(node.handler, this.guarded(context, this.catchCondition(node.handler)));
        if (node.finalizer) this.visit(node.finalizer, context);
        return;
      case 'SwitchStatement': {
        const discriminant = this.text(node.discriminant);
        const values = node.cases.flatMap((switchCase) => (switchCase.test ? [this.text(switchCase.test)] : []));
        // The default case runs when no other case matches.
        const otherwise = values.map((value) => `${discriminant} !== ${value}`).join(' && ');
        this.visit(node.discriminant, context);
        for (const switchCase of node.cases) {
          const guard = switchCase.test ? `${discriminant} === ${this.text(switchCase.test)}` : otherwise;
          this.visit(switchCase, this.guarded(context, guard === '' ? null : guard));
        }
        return;
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
        this.visitChildren(node, { ...context, isInLoop: true });
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        // A function outside any test or hook runs when it is called; what it sets applies where it is called.
        const helper = context.test || context.hookScope ? null : node;
        const named = helper !== null && this.isNamed(node);
        // In an imported helper's module, a function runs only when it is called, and is walked then.
        if (named && this.frame !== this.main) return;
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
          guards: helper ? [] : context.guards,
        });
        return;
      }
    }
    this.visitChildren(node, context);
  }

  /** Whether a function has a name it can be called by: `function name() {}` or `const name = () => {}`. */
  private isNamed(fn: Node): boolean {
    const parent = this.parents.at(-2);
    return (
      (fn.type === 'FunctionDeclaration' && fn.id !== null) ||
      (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier' && parent.init === fn)
    );
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

  private guarded(context: Context, guard: string | null): Context {
    return { ...context, isInCondition: true, guards: guard === null ? context.guards : [...context.guards, guard] };
  }

  /** Visits the body of a callback the framework or a loop calls, rather than a plain function. */
  private visitCallback(fn: FunctionNode, context: Context): void {
    this.scopes.push(fn);
    this.parents.push(fn);
    for (const parameter of fn.params) this.visit(parameter, context);
    // Function expressions and arrows always have a body; only declarations of overloads don't.
    this.visit(fn.body as Node, context);
    this.parents.pop();
    this.scopes.pop();
  }

  private text(node: Span): string {
    return snippet(this.frame.parsed.source.slice(node.start, node.end));
  }

  /** `symbols.forEach((symbol) => test(...))` declares its tests in a loop. */
  private loopCall(call: CallExpression, context: Context): boolean {
    const callee = unwrap(call.callee);
    if (callee.type !== 'MemberExpression' || !LOOP_METHODS.has(propertyName(callee) ?? '')) return false;
    this.visit(call.callee, context);
    for (const arg of call.arguments) {
      if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
        this.visitCallback(arg, { ...context, isInLoop: true });
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
      returnsOf: (name, scopes) => this.returnsOf(name, scopes),
    });
    if (!api) return false;
    return this.handle(call, api, context);
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
      case 'hook':
        if (context.test) return false;
        // A helper walked where it is written registers its hooks only where it is called.
        if (!context.hookScope && !context.helper && !context.quiet) context.scope.hooks[api.name] += 1;
        if (api.fn) {
          this.visitCallback(api.fn, {
            ...context,
            hookScope: context.scope,
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
        const afterLoad = context.test !== null || context.hookScope !== null || context.helper !== null;
        this.report(afterLoad ? { ...api.problem, afterLoad } : api.problem);
        return api.declaration ? this.handle(call, api.declaration, context) : true;
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
    const declaration = frame.values.declarationOf(name, scopes);
    if (declaration?.type === 'FunctionDeclaration') return declaration;
    const init = declaration?.type === 'VariableDeclarator' && declaration.init ? unwrap(declaration.init) : null;
    return init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression' ? init : null;
  }

  /**
   * Records a call to a function declared in the file. A call from the file or a describe returns the function, to be
   * walked there: its tests are registered in the describe around the call, and what it sets applies there. A call
   * from a test, a hook or another function is applied later, through the states the function sets.
   */
  private helperCall(call: CallExpression, context: Context): Callee | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'Identifier') return null;
    const fn = this.functionNamed(callee.name, this.scopes);
    if (!fn) {
      const runsHere = !context.test && !context.hookScope && !context.helper;
      const imported =
        runsHere && this.callStack.length < MAX_DEPTH ? this.importedFunction(callee.name, this.scopes) : null;
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
        guards: context.guards,
      });
    } else if (!this.callStack.includes(fn) && this.callStack.length < MAX_DEPTH) {
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

  /** The function a name imported from a local module stands for, in the file that writes it; null otherwise. */
  private importedFunction(name: string, scopes: readonly Node[], from = this.frame): Callee | null {
    const declaration = from.values.declarationOf(name, scopes);
    const source = from.values.importSource(name, scopes);
    if (source === null) return null;
    const imported = declaration?.type === 'ImportSpecifier' ? exportName(declaration.imported) : 'default';
    const frame = this.openFrom(from, source);
    return frame ? this.exportedFunction(frame, imported, new Set(), 0) : null;
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
    const local = (localName: string): Callee | null => {
      const fn = this.functionIn(frame, localName, [program]);
      return fn ? { fn, frame } : null;
    };
    const from = (source: string, exported: string): Callee | null => {
      const module = this.openFrom(frame, source);
      return module ? this.exportedFunction(module, exported, searched, depth + 1) : null;
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
    return null;
  }

  /**
   * Walks a function at one of its calls from the file or a describe, as the runner runs it there: with the scopes
   * where it is written, and its parameters bound to the call's arguments so that titles built from them resolve. A
   * function imported from another module is walked in that module, and what it registers points at this call.
   */
  private walkAtCall({ fn, frame }: Callee, call: CallExpression, context: Context): void {
    this.walkedAtCall.add(fn);
    // Arguments are worked out where the call is, in the file and scopes of the caller.
    const spread = call.arguments.findIndex((item) => item.type === 'SpreadElement');
    const args = (spread === -1 ? call.arguments : call.arguments.slice(0, spread)).map((item) =>
      this.frame.values.resolve(item as Expression, this.scopes),
    );
    const caller = this.frame;
    const site = this.site;
    if (frame !== caller) {
      this.frame = frame;
      this.site ??= call;
    }
    const scopes = this.scopeChain(fn);
    const saved = this.scopes.splice(0, this.scopes.length, ...scopes);
    this.callStack.push(fn);
    frame.values.withArguments(fn, args, scopes, () => {
      this.visitCallback(fn, {
        ...context,
        isInFunction: true,
        declaredIn: null,
        registeredAt: context.registeredAt ?? call.start,
      });
    });
    this.callStack.pop();
    this.scopes.splice(0, this.scopes.length, ...saved);
    // What the module's own imports couldn't resolve is reported at the call, as it is why tests may be missing.
    if (frame !== caller) {
      for (const item of frame.adapter.problems.filter((found) => !this.moduleProblems.has(found))) {
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
    const expand = (fn: Node, guards: string[], path: Set<Node>): Exclude<Effect, { kind: 'call' }>[] => {
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
    for (const [test, innermost] of this.declaredIn) {
      let why: string | null = null;
      for (let fn: Node | null = innermost; fn && !why; fn = (this.written.get(fn) as Written).declaredIn) {
        why = this.misplaced(fn, exported);
      }
      if (!why) continue;
      test.problems.push(
        problem(
          'test-in-function',
          test.call,
          `The test is declared in a function, and ${why}. The runner registers the test at each call of the function, in the describe around the call; it is listed once, where it is written.`,
        ),
      );
    }
  }

  private nested(call: CallExpression, context: Context): boolean {
    if (!context.test && !context.hookScope) return false;
    this.report(
      problem(
        'nested-test',
        call,
        'A test or describe declared inside a test or hook body is not collected by the runner, so it is not listed.',
        snippet(this.frame.parsed.source.slice(call.start, call.end)),
      ),
    );
    return true;
  }

  private declareTest(call: CallExpression, declaration: TestDeclaration, context: Context): void {
    if (context.quiet || this.nested(call, context)) return;
    const statement = this.statement(call);
    const test: PendingTest = {
      scope: context.scope,
      declaration,
      call,
      site: this.site,
      declaredAt: this.declaredAt(call),
      order: context.registeredAt ?? call.start,
      states: [...declaration.states],
      annotations: [...declaration.details.annotations],
      isInLoop: context.isInLoop,
      isInCondition: context.isInCondition,
      isInFunction: context.isInFunction,
      comments: this.commentsAbove(statement.start),
      problems: declaration.problems.map((item) => this.here(item)),
    };
    this.tests.push(test);
    if (context.declaredIn) this.declaredIn.set(test, context.declaredIn);
    this.cut(context.scope, call);
    if (declaration.fn) {
      this.visitCallback(declaration.fn, {
        ...context,
        test,
        hookScope: null,
        testContext: declaration.testContext,
        guards: [],
        helper: null,
      });
    }
  }

  private declareSuite(call: CallExpression, declaration: SuiteDeclaration, context: Context): void {
    if (context.quiet || this.nested(call, context)) return;
    for (const item of declaration.problems) this.report(item);
    const scope: Scope = {
      kind: 'describe',
      parent: context.scope,
      states: [...declaration.states],
      mode: declaration.mode,
      isOnly: declaration.isOnly,
      details: declaration.details,
      hooks: noHooks(),
      suite: null,
    };
    const suite: PendingSuite = {
      scope,
      declaration,
      call,
      site: this.site,
      declaredAt: this.declaredAt(call),
      order: context.registeredAt ?? call.start,
      cuts: [],
    };
    scope.suite = suite;
    this.suites.push(suite);
    this.cut(context.scope, call);
    this.suiteFrames.set(suite, this.frame);
    if (declaration.fn) {
      this.visitCallback(declaration.fn, {
        ...context,
        scope,
        test: null,
        hookScope: null,
        testContext: null,
        guards: [],
        helper: null,
      });
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
export function extract(main: Frame, openModule: OpenModule): Extraction {
  return new Walker(main, openModule).run();
}
