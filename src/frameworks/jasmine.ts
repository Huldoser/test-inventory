import type { CallExpression, Expression } from 'oxc-parser';
import { isFunctionNode, unwrap, type FunctionNode } from '../ast.ts';
import type { ApiCall, CallContext, ModuleReader, Problem } from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import { snippet } from '../source.ts';
import type { DiagnosticCode, HookCounts } from '../types.ts';
import {
  atLeast,
  hookFunction,
  namedFunction,
  problem,
  readChain,
  readCount,
  readReason,
  readTitle,
  refused,
  text,
  type FileContext,
  type Link,
} from './common.ts';
import { SuiteAdapter, type Dialect, type Kind } from './test-functions.ts';

const HOOKS = ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'] as const;

const JASMINE: Dialect = {
  name: 'Jasmine',
  // Jasmine has no module to import its functions from: they are globals, set by the jasmine command, Karma or a
  // browser page.
  source: 'jasmine-core',
  mismatched: new Set(['@playwright/test', 'playwright/test', 'vitest', '@jest/globals', 'mocha']),
  starts: new Map([
    ['describe', { kind: 'describe', links: [] }],
    ['xdescribe', { kind: 'describe', links: ['skip'] }],
    ['fdescribe', { kind: 'describe', links: ['only'] }],
    ['it', { kind: 'test', links: [] }],
    ['xit', { kind: 'test', links: ['skip'] }],
    ['fit', { kind: 'test', links: ['only'] }],
  ]),
  hooks: new Map(HOOKS.map((name) => [name, name])),
  derivations: new Set(),
  modifiers: new Set(),
  carriesKinds: false,
  isModule: () => false,
  defaultImport: null,
  required: null,
};

/**
 * Marks what runs with each spec, the spec and its `beforeEach` and `afterEach` hooks, where `pending()` marks the spec
 * pending, and a describe, around which Jasmine catches what its callback throws.
 */
const IN_SPEC = Symbol('in a spec');
const IN_DESCRIBE = Symbol('in a describe');

export class JasmineAdapter extends SuiteAdapter {
  /** What the runner does with a call it refuses at the top level of a file, as the end of a sentence. */
  protected readonly refusedEffect: string = 'Jasmine stops before it runs any spec';
  /** Whether a number after a spec's timeout is a retry count, as WebdriverIO reads it. */
  protected readonly trailingRetries: boolean = false;

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    super(parsed, file, readModule, JASMINE, []);
  }

  classify(call: CallExpression, context: CallContext): ApiCall | null {
    return this.pendingCall(call, context) ?? this.hookCall(call, context) ?? this.chainCall(call, context);
  }

  /** `skip` and `only` are what `xit`, `fit`, `xdescribe` and `fdescribe` carry, so a variable may hold them. */
  protected isAliasLink(_kind: Kind, link: Link): boolean {
    return link.name === 'skip' || link.name === 'only';
  }

  protected hook(call: CallExpression, name: keyof HookCounts, context: CallContext): ApiCall {
    const fn = hookFunction(this.file, context.scopes, call.arguments);
    // In `beforeAll` and `afterAll`, `pending()` is an error of the describe, and the specs keep the state they get.
    const testContext = name === 'beforeEach' || name === 'afterEach' ? IN_SPEC : null;
    return { kind: 'hook', name, fn, testContext, fixtures: [], takesAllFixtures: false };
  }

  /**
   * `pending(reason)` in a spec or its `beforeEach` or `afterEach` hook, and from Jasmine 7 `notApplicable(reason)`,
   * which mark the spec as not run, with the reason (checked with Jasmine 4.6.0, 5.13.0 and 7.0.0).
   */
  private pendingCall(call: CallExpression, context: CallContext): ApiCall | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'Identifier' || context.testContext !== IN_SPEC) return null;
    const isPending = callee.name === 'pending';
    const isNotApplicable = callee.name === 'notApplicable' && atLeast(this.file.version, 7, 0);
    if (!isPending && !isNotApplicable) return null;
    if (this.file.values.declarationOf(callee.name, context.scopes) !== null) return null;
    const reason = readReason(this.file, context.scopes, call.arguments.at(0));
    return {
      kind: 'modifier',
      state: 'skip',
      condition: { applies: 'always', text: null },
      reason: reason.reason,
      hasDynamicReason: reason.isDynamic,
      problems: reason.problem ? [reason.problem] : [],
    };
  }

  private chainCall(call: CallExpression, context: CallContext): ApiCall | null {
    const chain = readChain(call.callee);
    if (!chain) return null;
    const resolved = this.resolve(chain, call.arguments, context);
    if (!resolved) return null;
    const { kind, links } = resolved;
    const callee = snippet(text(this.file, call.callee));
    // Jasmine's functions have no members: `xit` and `fit` carry their modifier in the name.
    if (chain.links.length === 0) return this.declaration(call, kind, links, context);
    const refusal = this.refusal('invalid-chain', call, `${callee} is not part of Jasmine's API`, context);
    return refused(call, refusal, context, () => this.declaration(call, kind, [], context));
  }

  private declaration(call: CallExpression, kind: Kind, links: Link[], context: CallContext): ApiCall {
    const args = call.arguments;
    const callee = snippet(text(this.file, call.callee));
    // Jasmine registers `it()` as a pending spec titled '', and refuses a describe without a function.
    if (args.length === 0 && kind === 'describe') {
      return {
        kind: 'invalid',
        problem: this.refusal('test-without-body', call, `${callee}() has no function`, context),
      };
    }
    const flags = new Set(links.map((link) => link.name));
    const problems: Problem[] = [];
    let title = { text: '', withoutTags: '', isDynamic: false };
    if (args.length > 0) {
      const read = readTitle(this.file, context.scopes, args[0], { stripTags: false, functionNames: false });
      title = read.title;
      if (read.problem) problems.push(read.problem);
    }
    const spread = args.some((arg) => arg.type === 'SpreadElement');
    const written = spread ? null : args.at(1);
    // `undefined` given as the function is no function, as when none is given.
    const body = written?.type === 'Identifier' && written.name === 'undefined' ? undefined : written;
    const fn = isFunctionNode(body) ? body : null;
    const callback = fn ?? namedFunction(this.file, context.scopes, body ?? undefined);
    const line = this.file.source.line(call.start);
    // A spec without a function is pending, unless it is focused: `fit` needs one.
    const isSkipped = flags.has('skip') || (kind === 'test' && body === undefined);
    const base = {
      title,
      states: isSkipped
        ? [{ state: 'skip' as const, condition: null, reason: null, hasDynamicReason: false, line }]
        : [],
      isOnly: flags.has('only'),
      mode: null,
      details: { tags: [], annotations: [], locks: [], meta: null, run: {} },
      fn,
      hashed: callback,
      isParameterized: false,
      caseCount: null,
      cases: null,
      problems,
    };
    if (kind === 'test') {
      const declared: ApiCall = {
        kind: 'test',
        ...base,
        testContext: IN_SPEC,
        fixtures: [],
        takesAllFixtures: false,
        usesBench: false,
      };
      const timeout = spread ? undefined : args.at(2);
      if (timeout && timeout.type !== 'SpreadElement') {
        const option = { node: timeout, resolved: this.file.values.resolve(timeout, context.scopes) };
        const value = readCount(this.file, 'timeout', option, problems);
        if (value !== null) declared.details.run = { timeout: value };
      }
      const retries = this.trailingRetries && !spread ? args.at(3) : undefined;
      if (retries && retries.type !== 'SpreadElement') {
        const option = { node: retries, resolved: this.file.values.resolve(retries, context.scopes) };
        const count = readCount(this.file, 'retries', option, problems);
        if (count !== null)
          declared.details.run = { ...declared.details.run, retry: { count, delay: null, condition: null } };
      }
      if (body === null || (body === undefined ? !flags.has('only') : isFunctionLike(body))) return declared;
      const reason = body === undefined ? `${callee}() has no function` : `${callee}() takes a function second`;
      return refused(call, this.refusal('test-without-body', call, reason, context), context, () => declared);
    }
    const declared: ApiCall = { kind: 'describe', ...base, isShuffled: false, passesDown: IN_DESCRIBE };
    if (body === null) return declared;
    if (body === undefined || !isFunctionLike(body)) {
      const refusal = this.refusal('test-without-body', call, `${callee}() has no function`, context);
      return refused(call, refusal, context, () => declared);
    }
    if (callback?.async) {
      const refusal = this.refusal(
        'async-describe',
        callback,
        'The describe callback is async, which Jasmine refuses',
        context,
      );
      return refused(call, refusal, context, () => declared);
    }
    if (callback && declaresNothing(callback)) {
      const refusal = this.refusal(
        'describe-throws',
        callback,
        'The describe declares no spec or describe, which Jasmine refuses',
        context,
      );
      return refused(call, refusal, context, () => declared);
    }
    if (callback && functionLength(callback) > 0) {
      const refusal = this.refusal(
        'describe-throws',
        callback,
        'The describe callback takes arguments, which Jasmine refuses',
        context,
      );
      return refused(call, refusal, context, () => declared);
    }
    return declared;
  }

  /**
   * A call Jasmine refuses: written at the top level of a file, it stops Jasmine before it runs any spec; inside a
   * describe, Jasmine catches it, reports the describe as failed, and registers none of the specs written after it there.
   */
  private refusal(
    code: DiagnosticCode,
    node: CallExpression | Expression,
    what: string,
    context: CallContext,
  ): Problem {
    const source = snippet(text(this.file, node));
    if (context.passedDown !== IN_DESCRIBE) {
      return problem(code, node, `${what}, so ${this.refusedEffect}.`, source);
    }
    const message = `${what}, so the describe around it throws: Jasmine reports it as failed, and registers none of the specs written after this call in it.`;
    return { ...problem(code, node, message, source), afterLoad: true };
  }
}

/**
 * Whether a describe callback surely declares nothing: its body is empty or holds only hook calls. A call to anything
 * else, as a helper that declares specs, may declare some.
 */
function declaresNothing(fn: FunctionNode): boolean {
  if (fn.body?.type !== 'BlockStatement') return false;
  return fn.body.body.every((statement) => {
    if (statement.type !== 'ExpressionStatement') return false;
    const expression = unwrap(statement.expression);
    if (expression.type !== 'CallExpression') return false;
    const callee = unwrap(expression.callee);
    return callee.type === 'Identifier' && (HOOKS as readonly string[]).includes(callee.name);
  });
}

/** Whether an argument may be a function: anything but a value that can't be one, as a number or an object. */
function isFunctionLike(node: CallExpression['arguments'][number]): boolean {
  const value = unwrap(node as Expression);
  return !['Literal', 'ObjectExpression', 'ArrayExpression', 'TemplateLiteral'].includes(value.type);
}

/**
 * A function's `length`, which Jasmine checks: its parameters before the first with a default value or a rest, without
 * TypeScript's `this`, which is no parameter at run time.
 */
function functionLength(fn: FunctionNode): number {
  const params = fn.params.filter((param) => param.type !== 'Identifier' || param.name !== 'this');
  const end = params.findIndex((param) => param.type === 'AssignmentPattern' || param.type === 'RestElement');
  return end === -1 ? params.length : end;
}
