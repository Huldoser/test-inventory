import type { Argument, CallExpression, Node } from 'oxc-parser';
import { isFunctionNode, propertyName, unwrap, type FunctionNode } from '../ast.ts';
import type {
  ApiCall,
  CallContext,
  ModuleReader,
  Problem,
  RunSettings,
  SuiteDeclaration,
  TestDeclaration,
} from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import { snippet } from '../source.ts';
import type { HookCounts } from '../types.ts';
import { requiredModule } from './bindings.ts';
import {
  atLeast,
  hookFunction,
  namedFunction,
  problem,
  readChain,
  readCount,
  readTitle,
  refused,
  text,
  type FileContext,
  type Link,
} from './common.ts';
import { SuiteAdapter, type Dialect, type Kind } from './test-functions.ts';

const SOURCE = 'mocha';
const MISMATCHED = new Set(['@playwright/test', 'playwright/test', 'vitest', '@jest/globals']);
const MODIFIERS = new Set(['only', 'skip']);

/** Which of `test` and `describe` each global is, and the modifier it carries, by interface. */
const STARTS: Record<MochaInterface, [string, Kind, string[]][]> = {
  bdd: [
    ['describe', 'describe', []],
    ['context', 'describe', []],
    ['xdescribe', 'describe', ['skip']],
    ['xcontext', 'describe', ['skip']],
    ['it', 'test', []],
    ['specify', 'test', []],
    ['xit', 'test', ['skip']],
    ['xspecify', 'test', ['skip']],
  ],
  tdd: [
    ['suite', 'describe', []],
    ['test', 'test', []],
  ],
};

const HOOKS: Record<MochaInterface, [string, keyof HookCounts][]> = {
  bdd: [
    ['before', 'beforeAll'],
    ['after', 'afterAll'],
    ['beforeEach', 'beforeEach'],
    ['afterEach', 'afterEach'],
  ],
  tdd: [
    ['suiteSetup', 'beforeAll'],
    ['suiteTeardown', 'afterAll'],
    ['setup', 'beforeEach'],
    ['teardown', 'afterEach'],
  ],
};

/** The interfaces Mocha's `ui` option names whose globals the scan reads; QUnit and exports declare tests otherwise. */
export type MochaInterface = 'bdd' | 'tdd';

export function dialect(ui: MochaInterface): Dialect {
  return {
    name: 'Mocha',
    source: SOURCE,
    mismatched: MISMATCHED,
    starts: new Map(STARTS[ui].map(([name, kind, links]) => [name, { kind, links }])),
    hooks: new Map(HOOKS[ui]),
    derivations: new Set(),
    modifiers: MODIFIERS,
    carriesKinds: false,
    isModule: (expression) => requiredModule(expression) === SOURCE,
    // `import mocha from 'mocha'` gives the module's exports, `describe` and `it` among them.
    defaultImport: null,
    required: null,
  };
}

/** Mocha's `ms` strings for a timeout, as `'2s'`; a bare number is milliseconds. */
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?$/;
const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_557_600_000,
};

export class MochaAdapter extends SuiteAdapter {
  /**
   * Whether `this.timeout()` and `this.retries()` set the tests' settings, as in Mocha. Cypress reads neither, and its
   * `retries()` throws.
   */
  protected readonly readsContextSettings: boolean = true;
  /** What the runner does with a call it refuses while it loads the file, as the end of a sentence. */
  protected readonly refusedEffect: string = 'Mocha stops before it runs any test';
  /** Whether a number after a test's function is a retry count, as WebdriverIO reads it. */
  protected readonly trailingRetries: boolean = false;

  constructor(
    parsed: ParsedFile,
    file: FileContext,
    readModule: ModuleReader | null,
    ui: MochaInterface = 'bdd',
    runner: Dialect = dialect(ui),
  ) {
    super(parsed, file, readModule, runner, MODIFIERS);
  }

  /** A declaration's function, and the options written before it; Mocha takes none. */
  protected splitArguments(args: CallExpression['arguments']): {
    body: Argument | undefined;
    options: Argument | null;
  } {
    return { body: args.at(1), options: null };
  }

  /** Sets on a declaration what the options written before its function set; Mocha takes none. */
  protected withOptions?(declared: TestDeclaration | SuiteDeclaration, options: Argument, context: CallContext): void;

  classify(call: CallExpression, context: CallContext): ApiCall | null {
    return (
      this.contextCall(call, context) ??
      this.chainedSetting(call, context) ??
      this.hookCall(call, context) ??
      this.chainCall(call, context)
    );
  }

  protected isAliasLink(_kind: Kind, link: Link): boolean {
    return MODIFIERS.has(link.name);
  }

  protected hook(call: CallExpression, name: keyof HookCounts, context: CallContext): ApiCall {
    const fn = hookFunction(this.file, context.scopes, call.arguments);
    // Mocha refuses `this.skip()` in an `after` hook, so the tests stay as they ran.
    const testContext = name === 'afterAll' ? null : ownThis(fn);
    return { kind: 'hook', name, fn, testContext, fixtures: [], takesAllFixtures: false };
  }

  /**
   * `this.timeout(n)`, `this.retries(n)` and `this.skip()` where `this` is Mocha's context: in a describe written as a
   * `function`, they set its tests' timeout and retries; in a test, its own; `this.skip()` in a test or hook skips the
   * tests it runs for. In a hook, `this.timeout()` sets the hook's own timeout, which no test record holds.
   */
  private contextCall(call: CallExpression, context: CallContext): ApiCall | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'MemberExpression' || unwrap(callee.object).type !== 'ThisExpression') return null;
    const name = propertyName(callee);
    // `this` is Mocha's only directly in the test's, hook's or describe's own function, not in a function inside it.
    const own = innermostFunction(context.scopes);
    const inTestOrHook = context.inBody && own !== null && own === context.testContext;
    const inDescribe = !context.inBody && own !== null && own === context.passedDown;
    if (!inTestOrHook && !inDescribe) return null;
    if (name === 'skip') {
      if (!inTestOrHook) return { kind: 'other' };
      return {
        kind: 'modifier',
        state: 'skip',
        condition: { applies: 'always', text: null },
        reason: null,
        hasDynamicReason: false,
        problems: [],
      };
    }
    if (name !== 'timeout' && name !== 'retries') return null;
    if (!this.readsContextSettings) {
      // In a test or hook, the throw fails that test or hook only, when it runs.
      if (name === 'timeout' || inTestOrHook) return { kind: 'other' };
      const source = snippet(text(this.file, call));
      const message = `${source} throws in ${this.dialect.name}, which takes retries in a describe's config, as describe(title, { retries: 2 }, fn), so ${this.refusedEffect}.`;
      return { kind: 'invalid', problem: problem('describe-throws', call, message, source) };
    }
    const argument = call.arguments.at(0);
    // Without an argument, `this.timeout()` only reads the timeout.
    if (!argument || (context.inBody && !context.inTest)) return { kind: 'other' };
    const problems: Problem[] = [];
    const settings = this.setting(name, argument, context, problems) ?? {};
    return { kind: 'run', settings, argument: snippet(text(this.file, argument)), problems };
  }

  /**
   * `it(title, fn).timeout(n)` and `.retries(n)`, which Mocha's `it` and `describe` return their test or suite for: the
   * declaration with the setting. A describe's tests are added before the call, and take its retries when they are
   * added, so `describe(...).retries(n)` reaches none of them; its timeout reaches them from Mocha 12, which reads it as
   * each test runs (checked with 10.8.2, 11.7.5 and 12.0.3).
   */
  private chainedSetting(call: CallExpression, context: CallContext): ApiCall | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'MemberExpression') return null;
    const name = propertyName(callee);
    if (name !== 'timeout' && name !== 'retries') return null;
    if (!this.readsContextSettings && name === 'timeout') return null;
    const target = unwrap(callee.object);
    if (target.type !== 'CallExpression') return null;
    const declared = this.classify(target, context);
    if (declared?.kind !== 'test' && declared?.kind !== 'describe') return null;
    if (!this.readsContextSettings) {
      if (context.inBody) return declared;
      const source = snippet(text(this.file, callee));
      const message = `${source}() throws in ${this.dialect.name}, which takes retries in the config before the function, as it(title, { retries: 2 }, fn), so ${this.refusedEffect}.`;
      return { kind: 'invalid', problem: problem('invalid-chain', call, message, source), declaration: declared };
    }
    if (declared.kind === 'describe' && (name === 'retries' || !atLeast(this.file.version, 12, 0))) return declared;
    const argument = call.arguments.at(0);
    const settings = argument ? this.setting(name, argument, context, declared.problems) : null;
    if (settings === null) return declared;
    return { ...declared, details: { ...declared.details, run: { ...declared.details.run, ...settings } } };
  }

  /** A timeout or a retry count from its argument; null, with a warning, when it can't be worked out. */
  private setting(
    name: 'timeout' | 'retries',
    argument: CallExpression['arguments'][number],
    context: CallContext,
    problems: Problem[],
  ): RunSettings | null {
    const resolved = argument.type === 'SpreadElement' ? null : this.file.values.resolve(argument, context.scopes);
    const value = resolved?.ok ? durationOf(resolved.value, name) : null;
    if (value === null) {
      const source = snippet(text(this.file, argument));
      const message = `The ${name} ${source} could not be worked out; it is not applied.`;
      problems.push(problem('unresolved-option', argument, message, source));
      return null;
    }
    return name === 'timeout' ? { timeout: value } : { retry: { count: value, delay: null, condition: null } };
  }

  private chainCall(call: CallExpression, context: CallContext): ApiCall | null {
    const chain = readChain(call.callee);
    const resolved = chain ? this.resolve(chain, call.arguments, context) : null;
    if (!resolved) return null;
    const { kind, links } = resolved;
    const valid = links.length <= 1 && links.every((link) => MODIFIERS.has(link.name) && !link.args && !link.template);
    if (valid) return this.declaration(call, kind, links, context);
    const callee = snippet(text(this.file, call.callee));
    const refusal = problem(
      'invalid-chain',
      call,
      `${callee} is not part of ${this.dialect.name}'s API; the call throws, and ${this.refusedEffect}.`,
      callee,
    );
    return refused(call, refusal, context, () => this.declaration(call, kind, [], context));
  }

  private declaration(call: CallExpression, kind: Kind, links: Link[], context: CallContext): ApiCall {
    const args = call.arguments;
    if (args.length === 0) {
      const callee = snippet(text(this.file, call.callee));
      const message = `${callee}() has no title, so ${this.refusedEffect}.`;
      return { kind: 'invalid', problem: problem('test-without-body', call, message, callee) };
    }
    const flags = new Set(links.map((link) => link.name));
    const problems: Problem[] = [];
    const { title, problem: titleProblem } = readTitle(this.file, context.scopes, args[0], {
      stripTags: false,
      functionNames: false,
    });
    if (titleProblem) problems.push(titleProblem);
    const { body, options } = this.splitArguments(args);
    const fn = isFunctionNode(body) ? body : null;
    const hashed = fn ?? namedFunction(this.file, context.scopes, body);
    const line = this.file.source.line(call.start);
    // A test without a function is pending, which Mocha reports as skipped.
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
      hashed,
      isParameterized: false,
      caseCount: null,
      cases: null,
      problems,
    };
    if (kind === 'test') {
      const test: TestDeclaration = {
        kind: 'test',
        ...base,
        testContext: ownThis(hashed),
        fixtures: [],
        takesAllFixtures: false,
        usesBench: false,
      };
      // WebdriverIO retries the function that many times inside each of Mocha's attempts, so 0 leaves Mocha's retries.
      const retries = this.trailingRetries && args.length >= 3 ? args.at(-1) : undefined;
      if (retries && retries.type !== 'SpreadElement') {
        const option = { node: retries, resolved: this.file.values.resolve(retries, context.scopes) };
        const count = readCount(this.file, 'retries', option, problems);
        if (count) test.details.run = { retry: { count, delay: null, condition: null } };
      }
      if (options) this.withOptions?.(test, options, context);
      return test;
    }
    const declared: SuiteDeclaration = { kind: 'describe', ...base, isShuffled: false, passesDown: ownThis(hashed) };
    if (options) this.withOptions?.(declared, options, context);
    if (body !== undefined || flags.has('skip')) return declared;
    const callee = snippet(text(this.file, call.callee));
    const refusal = problem(
      'test-without-body',
      call,
      `${callee}() has no function, so ${this.refusedEffect}.`,
      callee,
    );
    return refused(call, refusal, context, () => declared);
  }
}

/**
 * A test's, hook's or describe's function written with `function`, whose `this` is Mocha's context while it runs; null
 * for an arrow function, whose `this` is whatever is around it.
 */
function ownThis(fn: FunctionNode | null): FunctionNode | null {
  return fn && fn.type !== 'ArrowFunctionExpression' ? fn : null;
}

/** The innermost function around a call that has its own `this`: one not written as an arrow. */
function innermostFunction(scopes: readonly Node[]): Node | null {
  return (
    scopes.findLast((scope) => scope.type === 'FunctionExpression' || scope.type === 'FunctionDeclaration') ?? null
  );
}

/** The largest timeout Mocha keeps; it takes this one and any larger as no timeout, 0. */
const LONGEST = 2 ** 31 - 1;

/** A timeout in milliseconds or a retry count as Mocha reads it; null for a value it doesn't take. */
export function durationOf(value: unknown, name: 'timeout' | 'retries'): number | null {
  if (name === 'retries') return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  let ms: number | null = null;
  if (typeof value === 'number') {
    ms = value;
  } else if (typeof value === 'string') {
    const match = DURATION.exec(value.trim());
    // An optional group that matched nothing is undefined, though the type says it is a string.
    if (match) ms = Number(match[1]) * UNITS[(match[2] as string | undefined) ?? 'ms'];
  }
  if (ms === null || Number.isNaN(ms)) return null;
  if (ms <= 0 || ms >= LONGEST) return 0;
  return Number.isInteger(ms) ? ms : null;
}
