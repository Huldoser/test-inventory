import type { CallExpression, Node, Program } from 'oxc-parser';
import { childNodes, isImportMetaVitest, propertyName, unwrap, type FunctionNode } from './ast.ts';
import { exportName } from './frameworks/bindings.ts';
import { problem } from './frameworks/common.ts';
import type {
  Adapter,
  ApiCall,
  Details,
  Mode,
  Problem,
  Span,
  StateSetting,
  SuiteDeclaration,
  TestDeclaration,
} from './model.ts';
import type { ParsedFile } from './parse.ts';
import { snippet, splitLines } from './source.ts';
import type { Annotation } from './types.ts';
import { isScopeNode, type Values } from './values.ts';

/** The file or a describe, with what is set on it. Tests inherit from every scope around them. */
export interface Scope {
  kind: 'file' | 'describe';
  parent: Scope | null;
  states: StateSetting[];
  mode: Mode | null;
  isOnly: boolean;
  details: Details;
  suite: PendingSuite | null;
}

export interface PendingSuite {
  scope: Scope;
  declaration: SuiteDeclaration;
  call: CallExpression;
  /** Statements of the tests and describes directly inside, left out of the describe's body hash. */
  cuts: Span[];
}

export interface PendingTest {
  scope: Scope;
  declaration: TestDeclaration;
  call: CallExpression;
  /** States from the declaration, then from calls in the body such as `test.skip(condition)`. */
  states: StateSetting[];
  annotations: Annotation[];
  isInLoop: boolean;
  isInCondition: boolean;
  isInFunction: boolean;
  comments: string[];
  problems: Problem[];
}

export interface Extraction {
  suites: PendingSuite[];
  tests: PendingTest[];
  /** Problems not tied to one test. */
  problems: Problem[];
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
}

/** What a helper function does when called: set a state or mode, or call another helper in the file. */
type Effect =
  | { kind: 'state'; setting: StateSetting; call: CallExpression }
  | { kind: 'mode'; mode: Mode; call: CallExpression }
  | { kind: 'call'; fn: Node; guards: string[] };

/** A call to a helper function from a test, a hook, or the body of a describe or the file. */
interface HelperCall {
  fn: Node;
  target: PendingTest | Scope;
  /** The describe or file the helper is called in directly, where a mode it sets applies; null in a test or hook. */
  scope: Scope | null;
  guards: string[];
}

const LOOP_METHODS = new Set(['forEach', 'map']);

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

class Walker {
  private readonly scopes: Node[] = [];
  private readonly parents: Node[] = [];
  private readonly fileScope: Scope;
  private readonly suites: PendingSuite[] = [];
  private readonly tests: PendingTest[] = [];
  private readonly problems: Problem[] = [];
  private readonly parsed: ParsedFile;
  private readonly adapter: Adapter;
  private readonly values: Values;
  private readonly effects = new Map<Node, Effect[]>();
  private readonly helperCalls: HelperCall[] = [];

  constructor(parsed: ParsedFile, adapter: Adapter, values: Values) {
    this.parsed = parsed;
    this.adapter = adapter;
    this.values = values;
    this.fileScope = {
      kind: 'file',
      parent: null,
      states: [],
      mode: null,
      isOnly: false,
      details: { tags: adapter.fileTags, annotations: [], locks: [], meta: null },
      suite: null,
    };
  }

  run(): Extraction {
    this.visit(this.parsed.program, {
      scope: this.fileScope,
      test: null,
      hookScope: null,
      testContext: null,
      guards: [],
      isInLoop: false,
      isInCondition: false,
      isInFunction: false,
      helper: null,
    });
    this.applyHelpers();
    return {
      suites: this.suites,
      tests: this.tests,
      problems: [...this.adapter.problems, ...this.problems],
      usesGlobals: this.adapter.usesGlobals,
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
      case 'CallExpression':
        this.helperCall(node, context);
        if (this.call(node, context) || this.loopCall(node, context)) return;
        break;
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

  private text(node: Node): string {
    return snippet(this.parsed.source.slice(node.start, node.end));
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
    const api = this.adapter.classify(call, {
      scopes: this.scopes,
      testContext: context.testContext,
      inTest: context.test !== null,
      inBody: context.test !== null || context.hookScope !== null,
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
        (context.test?.problems ?? this.problems).push(...api.problems);
        if (api.condition.applies === 'never') return true;
        const own = api.condition.applies === 'sometimes' ? [api.condition.text as string] : [];
        const setting: StateSetting = {
          state: api.state,
          condition: joinConditions([...context.guards, ...own]),
          reason: api.reason,
          hasDynamicReason: api.hasDynamicReason,
          line: this.parsed.source.line(call.start),
        };
        if (context.helper) this.effectsOf(context.helper).push({ kind: 'state', setting, call });
        else (context.test ?? context.hookScope ?? context.scope).states.push(setting);
        return true;
      }
      case 'mode':
        if (context.helper) this.effectsOf(context.helper).push({ kind: 'mode', mode: api.mode, call });
        else if (!context.test && !context.hookScope) context.scope.mode = api.mode;
        return true;
      case 'hook':
        if (context.test) return false;
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
        context.test?.problems.push(...api.problems);
        return true;
      case 'invalid': {
        const afterLoad = context.test !== null || context.hookScope !== null || context.helper !== null;
        this.problems.push(afterLoad ? { ...api.problem, afterLoad } : api.problem);
        return true;
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
  private functionNamed(name: string, scopes: readonly Node[]): Node | null {
    const declaration = this.values.declarationOf(name, scopes);
    if (declaration?.type === 'FunctionDeclaration') return declaration;
    const init = declaration?.type === 'VariableDeclarator' && declaration.init ? unwrap(declaration.init) : null;
    return init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression' ? init : null;
  }

  /** Records a call to a function declared in the file, so that the states it sets can follow the call. */
  private helperCall(call: CallExpression, context: Context): void {
    const callee = unwrap(call.callee);
    const fn = callee.type === 'Identifier' ? this.functionNamed(callee.name, this.scopes) : null;
    if (!fn) return;
    if (context.helper) {
      this.effectsOf(context.helper).push({ kind: 'call', fn, guards: context.guards });
    } else {
      const target = context.test ?? context.hookScope ?? context.scope;
      const scope = context.test || context.hookScope ? null : context.scope;
      this.helperCalls.push({ fn, target, scope, guards: context.guards });
    }
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
  private applyHelpers(): void {
    const exported = this.exportedFunctions(this.parsed.program);
    const reached = new Set<Node>();
    const expand = (fn: Node, guards: string[], path: Set<Node>): Exclude<Effect, { kind: 'call' }>[] => {
      if (path.has(fn) || exported.has(fn)) return [];
      reached.add(fn);
      return (this.effects.get(fn) ?? []).flatMap((effect) => {
        if (effect.kind === 'call') return expand(effect.fn, [...guards, ...effect.guards], new Set([...path, fn]));
        if (effect.kind === 'mode') return [effect];
        const condition = joinConditions([...guards, ...(effect.setting.condition ? [effect.setting.condition] : [])]);
        return [{ ...effect, setting: { ...effect.setting, condition } }];
      });
    };
    for (const call of this.helperCalls) {
      for (const effect of expand(call.fn, call.guards, new Set())) {
        if (effect.kind === 'state') call.target.states.push(effect.setting);
        else if (call.scope) call.scope.mode = effect.mode;
      }
    }
    for (const [fn, effects] of this.effects) {
      const own = effects.find((effect) => effect.kind !== 'call');
      if (!own || (reached.has(fn) && !exported.has(fn))) continue;
      const callee = snippet(this.parsed.source.slice(own.call.callee.start, own.call.callee.end));
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

  private nested(call: CallExpression, context: Context): boolean {
    if (!context.test && !context.hookScope) return false;
    this.problems.push(
      problem(
        'nested-test',
        call,
        'A test or describe declared inside a test or hook body is not collected by the runner, so it is not listed.',
        snippet(this.parsed.source.slice(call.start, call.end)),
      ),
    );
    return true;
  }

  private declareTest(call: CallExpression, declaration: TestDeclaration, context: Context): void {
    if (this.nested(call, context)) return;
    const statement = this.statement(call);
    const test: PendingTest = {
      scope: context.scope,
      declaration,
      call,
      states: [...declaration.states],
      annotations: [...declaration.details.annotations],
      isInLoop: context.isInLoop,
      isInCondition: context.isInCondition,
      isInFunction: context.isInFunction,
      comments: this.commentsAbove(statement.start),
      problems: [...declaration.problems],
    };
    this.tests.push(test);
    context.scope.suite?.cuts.push(statement);
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
    if (this.nested(call, context)) return;
    this.problems.push(...declaration.problems);
    const scope: Scope = {
      kind: 'describe',
      parent: context.scope,
      states: [...declaration.states],
      mode: declaration.mode,
      isOnly: declaration.isOnly,
      details: declaration.details,
      suite: null,
    };
    const suite: PendingSuite = { scope, declaration, call, cuts: [] };
    scope.suite = suite;
    this.suites.push(suite);
    context.scope.suite?.cuts.push(this.statement(call));
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
    const { comments, source } = this.parsed;
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

export function extract(parsed: ParsedFile, adapter: Adapter, values: Values): Extraction {
  return new Walker(parsed, adapter, values).run();
}
