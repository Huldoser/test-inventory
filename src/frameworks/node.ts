import type { Argument, CallExpression, Expression } from 'oxc-parser';
import { isFunctionNode, propertyName, unwrap, type FunctionNode } from '../ast.ts';
import type { ApiCall, CallContext, Mode, ModuleReader, Problem, StateSetting } from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import { snippet } from '../source.ts';
import type { HookCounts } from '../types.ts';
import { requiredModule } from './bindings.ts';
import {
  hookFunction,
  namedFunction,
  problem,
  readChain,
  readCount,
  readOptions,
  readReason,
  readStrings,
  readTitle,
  refused,
  text,
  unresolvedOption,
  unresolvedOptions,
  type FileContext,
  type Link,
  type OptionValue,
} from './common.ts';
import { SuiteAdapter, type Dialect, type Kind, type Start } from './test-functions.ts';

const MODIFIERS = new Set(['skip', 'todo', 'only', 'expectFailure']);

const PRECEDENCE = ['skip', 'todo', 'expectedToFail'];

const TEST: Start = { kind: 'test', links: [] };

const NODE: Dialect = {
  name: 'node:test',
  source: 'node:test',
  mismatched: new Set(['@playwright/test', 'playwright/test', 'vitest', '@jest/globals', 'mocha']),
  starts: new Map<string, Start>([
    ['test', TEST],
    ['it', TEST],
    ['describe', { kind: 'describe', links: [] }],
    ['suite', { kind: 'describe', links: [] }],
    // `test`'s own members, which node:test also exports by name.
    ...['skip', 'todo', 'only', 'expectFailure'].map((name): [string, Start] => [
      name,
      { kind: 'test', links: [name] },
    ]),
  ]),
  hooks: new Map<string, keyof HookCounts>([
    ['before', 'beforeAll'],
    ['after', 'afterAll'],
    ['beforeEach', 'beforeEach'],
    ['afterEach', 'afterEach'],
  ]),
  derivations: new Set(),
  modifiers: MODIFIERS,
  carriesKinds: false,
  isModule: (expression: Expression) => requiredModule(expression) === 'node:test',
  defaultImport: null,
  required: null,
  callable: TEST,
  moduleMembers: new Set(['test', 'it']),
  // Every other export of node:test on Node.js 26; the hooks are read as hooks.
  others: new Set([
    'after',
    'afterEach',
    'assert',
    'before',
    'beforeEach',
    'default',
    'getTestContext',
    'mock',
    'run',
    'snapshot',
  ]),
  importOnly: true,
};

/**
 * Node.js's test runner, `node:test`. Its functions are imported, never globals; the module itself is `test`. A test
 * takes `(name, options, fn)`, each part optional, and a test or `test()` called in a test's body is a subtest of it.
 */
export class NodeAdapter extends SuiteAdapter {
  readonly nestsTests = true;

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    super(parsed, file, readModule, NODE, []);
  }

  classify(call: CallExpression, context: CallContext): ApiCall | null {
    return this.contextCall(call, context) ?? this.hookCall(call, context) ?? this.chainCall(call, context);
  }

  protected isAliasLink(_kind: Kind, link: Link): boolean {
    return MODIFIERS.has(link.name);
  }

  protected hook(call: CallExpression, name: keyof HookCounts, context: CallContext): ApiCall {
    const fn = hookFunction(this.file, context.scopes, call.arguments);
    return { kind: 'hook', name, fn, testContext: null, fixtures: [], takesAllFixtures: false };
  }

  /**
   * `t.skip(reason)` and `t.todo(reason)` on the test's context, which mark the test without stopping it, and
   * `t.test()`, a subtest.
   */
  private contextCall(call: CallExpression, context: CallContext): ApiCall | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'MemberExpression' || context.testContext === null || !context.inTest) return null;
    const object = unwrap(callee.object);
    if (object.type !== 'Identifier' || object.name !== context.testContext) return null;
    const name = propertyName(callee);
    if (name === 'test') return this.declaration(call, 'test', [], context);
    if (name !== 'skip' && name !== 'todo') return null;
    const reason = readReason(this.file, context.scopes, call.arguments.at(0));
    return {
      kind: 'modifier',
      state: name,
      condition: { applies: 'always', text: null },
      reason: reason.reason,
      hasDynamicReason: reason.isDynamic,
      problems: reason.problem ? [reason.problem] : [],
    };
  }

  private chainCall(call: CallExpression, context: CallContext): ApiCall | null {
    const chain = readChain(call.callee);
    const resolved = chain ? this.resolve(chain, call.arguments, context) : null;
    if (!resolved) return null;
    const { kind, links } = resolved;
    const valid =
      links.length <= 1 &&
      links.every(
        (link) =>
          MODIFIERS.has(link.name) &&
          !link.args &&
          !link.template &&
          (link.name !== 'expectFailure' || expectsFailure(this.file.version)),
      );
    if (valid) return this.declaration(call, kind, links, context);
    const callee = snippet(text(this.file, call.callee));
    const message = `${callee} is not part of node:test's API; the call throws, and Node.js fails the file and runs none of its tests.`;
    return refused(call, problem('invalid-chain', call, message, callee), context, () =>
      this.declaration(call, kind, [], context),
    );
  }

  private declaration(call: CallExpression, kind: Kind, links: Link[], context: CallContext): ApiCall {
    const named = (node: Argument) => namedFunction(this.file, context.scopes, node) !== null;
    const { name, options, body } = splitArguments(call.arguments, named);
    const problems: Problem[] = [];
    const fn = isFunctionNode(body) ? body : null;
    const hashed = fn ?? namedFunction(this.file, context.scopes, body);
    let title = { text: '<anonymous>', withoutTags: '<anonymous>', isDynamic: false };
    // Without a name, Node.js names the test after its function, which takes the name of the variable that holds it.
    const fnName = fn?.id?.name ?? (body?.type === 'Identifier' ? body.name : null);
    if (name) {
      const read = readTitle(this.file, context.scopes, name, { stripTags: false, functionNames: false });
      title = read.title;
      if (read.problem) problems.push(read.problem);
    } else if (fnName) {
      title = { text: fnName, withoutTags: fnName, isDynamic: false };
    }
    const line = this.file.source.line(call.start);
    const states: StateSetting[] = links
      .filter((link) => link.name !== 'only')
      .map((link) => ({
        state: link.name === 'expectFailure' ? 'expectedToFail' : (link.name as 'skip' | 'todo'),
        condition: null,
        reason: null,
        hasDynamicReason: false,
        line,
      }));
    const base = {
      title,
      states,
      isOnly: links.some((link) => link.name === 'only'),
      mode: null as Mode | null,
      details: { tags: [], annotations: [], locks: [], meta: null, run: {} },
      fn,
      hashed,
      isParameterized: false,
      caseCount: null,
      cases: null,
      problems,
    };
    const refusal = options ? this.withOptions(base, options, line, context) : null;
    // `skip` wins over `todo`, and both over `expectFailure`, however they are written.
    base.states.sort((a, b) => PRECEDENCE.indexOf(a.state) - PRECEDENCE.indexOf(b.state));
    const declared: ApiCall =
      kind === 'describe'
        ? { kind: 'describe', ...base, isShuffled: false, passesDown: null }
        : {
            kind: 'test',
            ...base,
            testContext: contextName(hashed),
            fixtures: [],
            takesAllFixtures: false,
            usesBench: false,
          };
    return refusal ? refused(call, refusal, context, () => declared) : declared;
  }

  /**
   * The options object: `skip` and `todo`, each `true` or a reason, `only`, `timeout`, `concurrency`, a number above 1
   * or `true` running the tests inside in parallel, from Node.js 24.14 and 25.5 `expectFailure`, whose string is its
   * label from 24.15 and 25.8, and from 24.19 and 26.2 `tags`.
   */
  private withOptions(
    declared: {
      states: StateSetting[];
      isOnly: boolean;
      mode: Mode | null;
      details: { tags: string[]; run: { timeout?: number | null } };
      problems: Problem[];
    },
    node: Argument,
    line: number,
    context: CallContext,
  ): Problem | null {
    const options = readOptions(this.file, context.scopes, node);
    const { problems } = declared;
    let refusal: Problem | null = null;
    problems.push(...unresolvedOptions(this.file, options, 'its states, timeout and tags are missing'));
    const states: ['skip' | 'todo' | 'expectedToFail', string][] = [
      ['skip', 'skip'],
      ['todo', 'todo'],
    ];
    if (expectsFailure(this.file.version)) states.push(['expectedToFail', 'expectFailure']);
    for (const [state, key] of states) {
      const option = options.values.get(key);
      if (!option) continue;
      const setting = stateFrom(
        this.file,
        state,
        option,
        line,
        state !== 'expectedToFail' || labelsFailure(this.file.version),
      );
      if (setting) declared.states.push(setting);
    }
    const only = options.values.get('only');
    if (only?.resolved.ok && only.resolved.value) declared.isOnly = true;
    const timeout = options.values.get('timeout');
    if (timeout) {
      const value = readCount(this.file, 'timeout', timeout, problems);
      if (value !== null) declared.details.run.timeout = value;
    }
    const concurrency = options.values.get('concurrency');
    if (concurrency && !concurrency.resolved.ok) {
      problems.push(
        unresolvedOption(
          this.file,
          'concurrency',
          concurrency.node,
          concurrency.resolved.importedFrom,
          'its mode is not applied',
        ),
      );
    } else if (concurrency?.resolved.ok) {
      const { value } = concurrency.resolved;
      if (value !== null && value !== undefined) {
        const count = typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 0xffff_ffff;
        if (typeof value !== 'boolean' && !count) {
          const source = snippet(text(this.file, concurrency.node));
          refusal = {
            ...problem(
              'unresolved-option',
              concurrency.node,
              `Option concurrency: ${source} is not a boolean or an integer from 1 to 4294967295, so Node.js refuses the call.`,
              source,
            ),
            level: 'error',
          };
        } else declared.mode = value === true || (typeof value === 'number' && value > 1) ? 'parallel' : 'default';
      }
    }
    const tags = options.values.get('tags');
    if (tags && readsTags(this.file.version)) {
      declared.details.tags.push(...readStrings(this.file, context.scopes, tags).values);
    }
    return refusal;
  }
}

/** Whether a version is at least the given release of its line, or of a later line. */
function since(version: [number, number] | null, releases: Record<number, number>, from: number): boolean {
  if (version === null) return true;
  const [major, minor] = version;
  return major >= from || (major in releases && minor >= releases[major]);
}

/** `expectFailure`: from Node.js 24.14 and 25.5. */
function expectsFailure(version: [number, number] | null): boolean {
  return since(version, { 24: 14, 25: 5 }, 26);
}

/** A string `expectFailure` as the failure's label: from 24.15 and 25.8. */
function labelsFailure(version: [number, number] | null): boolean {
  return since(version, { 24: 15, 25: 8 }, 26);
}

/** `tags`: from 24.19 and 26.2; Node.js 25 doesn't have them. */
function readsTags(version: [number, number] | null): boolean {
  return since(version, { 24: 19, 26: 2 }, 27);
}

/**
 * A state an option sets: any value but `false` and `undefined` sets it, as Node.js only checks for those two, with a
 * non-empty string as its reason; a value the scan can't work out sets it under its source text.
 */
function stateFrom(
  file: FileContext,
  state: 'skip' | 'todo' | 'expectedToFail',
  option: OptionValue,
  line: number,
  takesReason: boolean,
): StateSetting | null {
  const source = snippet(text(file, option.node));
  if (!option.resolved.ok) {
    return { state, condition: source, reason: null, hasDynamicReason: false, line };
  }
  const { value } = option.resolved;
  if (value === undefined || value === false) return null;
  const reason = typeof value === 'string' && value !== '' && takesReason ? value : null;
  return { state, condition: null, reason, hasDynamicReason: false, line };
}

/**
 * The name, options and function of a call, as Node.js reads `test([name][, options][, fn])`: a function first is the
 * test's function, an object first its options. A function may be written in place or passed by a name `named` finds.
 */
function splitArguments(
  args: CallExpression['arguments'],
  named: (node: Argument) => boolean,
): {
  name: Argument | undefined;
  options: Argument | undefined;
  body: Argument | undefined;
} {
  const [first, second, third] = args as (Argument | undefined)[];
  const isFunction = (node: Argument | undefined) => node !== undefined && (isFunctionLike(node) || named(node));
  if (isFunction(first)) return { name: undefined, options: undefined, body: first };
  if (first && isObjectLike(first)) return { name: undefined, options: first, body: second };
  if (isFunction(second)) return { name: first, options: undefined, body: second };
  return { name: first, options: second, body: third };
}

function isFunctionLike(node: Argument): boolean {
  return node.type !== 'SpreadElement' && isFunctionNode(unwrap(node));
}

function isObjectLike(node: Argument): boolean {
  return node.type !== 'SpreadElement' && unwrap(node).type === 'ObjectExpression';
}

/** The name the test's function gives its context, `t` in `(t) => {}`; null without one. */
function contextName(fn: FunctionNode | null): string | null {
  const param = fn?.params.at(0);
  return param?.type === 'Identifier' ? param.name : null;
}
