import type { CallExpression, Expression, Node } from 'oxc-parser';
import { isFunctionNode, unwrap } from '../ast.ts';
import type { ApiCall, CallContext, ModuleReader, Problem } from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import { snippet } from '../source.ts';
import type { DiagnosticCode, HookCounts } from '../types.ts';
import {
  atLeast,
  problem,
  readChain,
  readCount,
  readReason,
  readTitle,
  refused,
  text,
  type FileContext,
  type Link,
  wrappedFunction,
} from './common.ts';
import { SuiteAdapter, type Dialect, type Kind } from './test-functions.ts';
import {
  functionLength,
  isRuntimeFunction,
  jasmineSpread,
  jasmineArguments,
  jasmineCallback,
  jasmineRegistration,
  jasmineTitleValue,
  jasmineValue,
  registrationExit,
  type JasmineArgument,
} from './jasmine-registration.ts';

const HOOKS = ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'] as const;

const JASMINE: Dialect = {
  name: 'Jasmine',
  // Jasmine has no module to import its functions from: they are globals, set by the jasmine command, Karma or a
  // browser page.
  source: 'jasmine-core',
  mismatched: new Set([
    '@playwright/test',
    'playwright/test',
    'vitest',
    '@jest/globals',
    'mocha',
    'node:test',
    'bun:test',
  ]),
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
  readonly catchesSuiteErrors = true;
  registrationSpread(operand: Expression, scopes: readonly Node[]) {
    return jasmineSpread(operand, scopes, this.file);
  }
  registrationValue(operand: Expression, scopes: readonly Node[]) {
    return jasmineValue(operand, scopes, this.file);
  }
  registrationExit(block: Extract<Node, { type: 'BlockStatement' }>, scopes: readonly Node[]) {
    return registrationExit(block, scopes, this.file);
  }
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
    const [body, limit] = jasmineArguments(call.arguments, context.scopes, this.file, 2);
    const { status, fn } = jasmineRegistration(jasmineCallback(body, this.file), limit, this.file, false);
    if (status === 'callback' || status === 'timeout') {
      const reason = status === 'callback' ? 'requires a non-generator function' : 'refuses a timeout above 2147483647';
      return { kind: 'invalid', problem: this.refusal('invalid-hook', call, `${name}() ${reason}`, context) };
    }
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
    const spec = kind === 'test';
    const slots = jasmineArguments(args, context.scopes, this.file, spec ? (this.trailingRetries ? 4 : 3) : 2);
    const [titleArg, bodyArg] = slots;
    let title = { text: '', withoutTags: '', isDynamic: false };
    if (titleArg) {
      const read = readTitle(
        this.file,
        titleArg.scopes,
        titleArg.node,
        { stripTags: false, functionNames: false },
        jasmineTitleValue(titleArg, this.file, spec),
      );
      title = read.title;
      if (read.problem) problems.push(read.problem);
    }
    const body = bodyArg?.node;
    const read = jasmineCallback(bodyArg, this.file);
    const binding = read.binding;
    const callback = binding?.fn;
    // A function in a named tuple uses its defining scope, like a named callback.
    const fn = isFunctionNode(body) && bodyArg?.scopes === context.scopes ? body : null;
    const line = this.file.source.line(call.start);
    const isSkipped = flags.has('skip') || (spec && read.status === 'missing');
    const base = {
      title,
      states: isSkipped
        ? [{ state: 'skip' as const, condition: null, reason: null, hasDynamicReason: false, line }]
        : [],
      isOnly: flags.has('only'),
      mode: null,
      details: { tags: [], annotations: [], locks: [], meta: null, run: {} },
      fn,
      hashed: callback ?? wrappedFunction(body),
      isParameterized: false,
      caseCount: null,
      cases: null,
      problems,
    };
    if (spec) {
      const registration = jasmineRegistration(read, slots[2], this.file, !flags.has('only'));
      const declared: ApiCall = {
        kind: 'test',
        ...base,
        testContext: IN_SPEC,
        fixtures: [],
        takesAllFixtures: false,
        usesBench: false,
      };
      const readOption = (name: string, slot: JasmineArgument | null | undefined) => {
        if (!slot || slot.node.type === 'SpreadElement') return null;
        const resolved = slot.resolved ?? this.file.values.resolve(slot.node, slot.scopes);
        return readCount(this.file, name, { node: slot.node, resolved }, problems);
      };
      if (registration.status === 'timeout') {
        const refusal = this.refusal(
          'unresolved-option',
          call,
          `${callee}() refuses a timeout above 2147483647`,
          context,
        );
        return refused(call, { ...refusal, level: 'error' }, context, () => declared);
      }
      const timeout = readOption('timeout', slots[2]);
      if (timeout !== null) declared.details.run = { timeout };
      const retries = readOption('retries', slots[3]);
      if (retries !== null)
        declared.details.run = { ...declared.details.run, retry: { count: retries, delay: null, condition: null } };
      if (registration.status !== 'callback') return declared;
      const reason = registration.missing ? `${callee}() has no function` : `${callee}() takes a function second`;
      return refused(call, this.refusal('test-without-body', call, reason, context), context, () => declared);
    }
    const declared: ApiCall = { kind: 'describe', ...base, isShuffled: false, passesDown: IN_DESCRIBE };
    if (read.status === 'missing' || read.status === 'callback') {
      const refusal = this.refusal('test-without-body', call, `${callee}() has no function`, context);
      return refused(call, refusal, context, () => declared);
    }
    if (callback && (callback.async || callback.generator)) {
      const refusal = this.refusal(
        callback.async ? 'async-describe' : 'describe-throws',
        callback,
        `The describe callback is ${callback.async ? 'async' : 'a generator'}, which Jasmine refuses`,
        context,
      );
      return refused(call, refusal, context, () => declared);
    }
    const plain = flags.size === 0;
    if (callback && plain && functionLength(callback) > 0) {
      const refusal = this.refusal(
        'describe-throws',
        callback,
        'The describe callback takes arguments, which Jasmine refuses',
        context,
      );
      return refused(call, refusal, context, () => declared);
    }
    if (
      isRuntimeFunction(binding?.fn) &&
      atLeast(this.file.version, 4, plain ? 0 : 5) &&
      registrationExit({ call, fn: binding.fn, definition: binding.scopes, plain }, context.scopes, this.file) ===
        'throw'
    ) {
      const refusal = this.refusal(
        'describe-throws',
        binding.fn,
        'The describe declares no spec or describe, which Jasmine refuses',
        context,
      );
      return { ...declared, emptySuiteError: { problem: refusal, keepsScope: atLeast(this.file.version, 4, 5) } };
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
    if (context.handlesRegistrationError) {
      return problem(code, node, `${what}, so this call throws during Jasmine registration.`, source);
    }
    if (context.passedDown !== IN_DESCRIBE) {
      return problem(code, node, `${what}, so ${this.refusedEffect}.`, source);
    }
    const message = `${what}, so the describe around it throws: Jasmine reports it as failed, and registers none of the specs written after this call in it.`;
    return { ...problem(code, node, message, source), afterLoad: true };
  }
}
