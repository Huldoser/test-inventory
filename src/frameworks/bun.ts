import type { Argument, CallExpression, Expression } from 'oxc-parser';
import { isFunctionNode, unwrap } from '../ast.ts';
import { bunCaseTitle } from '../case-titles.ts';
import type {
  ApiCall,
  CallContext,
  Condition,
  Mode,
  ModuleReader,
  Problem,
  StateSetting,
  TableCase,
  Title,
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
  readCondition,
  readCount,
  readOptions,
  readTitle,
  refused,
  text,
  unresolvedOptions,
  type FileContext,
  type Link,
} from './common.ts';
import { SuiteAdapter, type Dialect, type Kind } from './test-functions.ts';

const SOURCE = 'bun:test';
/** Bun rewrites imports of these to `bun:test` in its test files. */
const ALIASES = new Set(['@jest/globals', 'vitest']);
/** The modes a chain may hold one of each group of, as Bun throws on a second. */
const GROUPS = [new Set(['skip', 'todo', 'failing']), new Set(['only']), new Set(['concurrent', 'serial'])];
const MODES = new Set(GROUPS.flatMap((group) => [...group]));
const CONDITIONS = new Set(['if', 'skipIf', 'todoIf', 'failingIf', 'concurrentIf', 'serialIf']);
const MODIFIERS = new Set([...MODES, ...CONDITIONS, 'each']);

const BUN: Dialect = {
  name: 'Bun',
  source: SOURCE,
  aliases: ALIASES,
  mismatched: new Set(['@playwright/test', 'playwright/test', 'mocha']),
  starts: new Map([
    ['test', { kind: 'test', links: [] }],
    ['it', { kind: 'test', links: [] }],
    ['describe', { kind: 'describe', links: [] }],
    ['xtest', { kind: 'test', links: ['skip'] }],
    ['xit', { kind: 'test', links: ['skip'] }],
    ['xdescribe', { kind: 'describe', links: ['skip'] }],
  ]),
  hooks: new Map((['beforeEach', 'afterEach', 'beforeAll', 'afterAll'] as const).map((name) => [name, name])),
  derivations: new Set(),
  modifiers: MODIFIERS,
  carriesKinds: false,
  isModule: (expression) => {
    const source = requiredModule(expression);
    return source === SOURCE || (source !== null && ALIASES.has(source));
  },
  defaultImport: null,
  required: null,
};

/**
 * Bun's `bun test`, from 1.2.23, which runs its tests the way 1.3 and 1.4 do. Its functions are globals in test files,
 * and imports of `bun:test`, `@jest/globals` and `vitest` give them too. A chain holds its modes in any order, one of
 * each group, and the conditions `if`, `skipIf`, `todoIf`, `failingIf`, `concurrentIf` and `serialIf` as often as
 * it likes; options go second or third.
 */
export class BunAdapter extends SuiteAdapter {
  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    super(parsed, file, readModule, BUN, MODIFIERS);
  }

  classify(call: CallExpression, context: CallContext): ApiCall | null {
    return this.hookCall(call, context) ?? this.chainCall(call, context);
  }

  protected isAliasLink(_kind: Kind, link: Link): boolean {
    return MODIFIERS.has(link.name);
  }

  protected hook(call: CallExpression, name: keyof HookCounts, context: CallContext): ApiCall {
    const fn = hookFunction(this.file, context.scopes, call.arguments);
    return { kind: 'hook', name, fn, testContext: null, fixtures: [], takesAllFixtures: false };
  }

  private chainCall(call: CallExpression, context: CallContext): ApiCall | null {
    const chain = readChain(call.callee);
    const resolved = chain ? this.resolve(chain, call.arguments, context) : null;
    if (!resolved) return null;
    const { kind, links } = resolved;
    const last = links.at(-1);
    if ((last?.name === 'each' || CONDITIONS.has(last?.name ?? '')) && !last?.args) return { kind: 'other' };
    if (this.isValid(kind, links, context)) return this.declaration(call, kind, links, context);
    const callee = snippet(text(this.file, call.callee));
    const refusal = problem(
      'invalid-chain',
      call,
      `${callee} is not part of Bun's API; the call throws, and Bun fails the file and runs none of its tests.`,
      callee,
    );
    return refused(call, refusal, context, () => this.declaration(call, kind, [], context));
  }

  /**
   * Whether Bun takes a chain: each mode once at most, one of `skip`, `todo` and `failing`, one of `concurrent` and
   * `serial`, one table, the conditions and the table called and the modes not, and no `failing` on a describe, which
   * a `failingIf` whose condition holds asks for too.
   */
  private isValid(kind: Kind, links: Link[], context: CallContext): boolean {
    const names = links.map((link) => link.name);
    if (!names.every((name) => MODIFIERS.has(name))) return false;
    if (GROUPS.some((group) => names.filter((name) => group.has(name)).length > 1)) return false;
    if (names.filter((name) => name === 'each').length > 1) return false;
    const called = links.every((link) => (MODES.has(link.name) ? !link.args : link.args !== null) && !link.template);
    if (!called) return false;
    if (kind !== 'describe') return true;
    return links.every(
      (link) =>
        link.name !== 'failing' && (link.name !== 'failingIf' || this.condition(link, context).applies !== 'always'),
    );
  }

  private condition(link: Link, context: CallContext): Condition {
    return readCondition(this.file, context.scopes, (link.args as Argument[]).at(0));
  }

  private declaration(call: CallExpression, kind: Kind, links: Link[], context: CallContext): ApiCall {
    const args = call.arguments;
    const callee = snippet(text(this.file, call.callee));
    const problems: Problem[] = [];
    const { title, problem: titleProblem } = readTitle(this.file, context.scopes, args[0], {
      stripTags: false,
      functionNames: true,
    });
    if (titleProblem) problems.push(titleProblem);
    const spread = args.some((arg) => arg.type === 'SpreadElement');
    // (title, fn, options) or (title, options, fn); a number is the timeout.
    const [second, third] = [args.at(1), args.at(2)];
    const fnSecond = third === undefined || isFunctionLike(second);
    const body = spread ? undefined : fnSecond ? second : third;
    const options = spread ? undefined : fnSecond ? third : second;
    const fn = isFunctionNode(body) ? body : null;
    const names = new Set(links.map((link) => link.name));
    const line = this.file.source.line(call.start);
    const states = this.states(links, line, context);
    const table = links.find((link) => link.name === 'each') ?? null;
    const run = this.options(options, problems, context);
    const base = {
      title,
      states,
      isOnly: names.has('only'),
      mode: this.mode(links, context),
      details: { tags: [], annotations: [], locks: [], meta: null, run },
      fn,
      hashed: fn ?? namedFunction(this.file, context.scopes, body),
      isParameterized: table !== null,
      caseCount: table ? this.caseCount(table, problems, context) : null,
      cases: table ? this.tableCases(table, title, context) : null,
      problems,
    };
    const declared: ApiCall =
      kind === 'describe'
        ? { kind: 'describe', ...base, isShuffled: false, passesDown: null }
        : { kind: 'test', ...base, testContext: null, fixtures: [], takesAllFixtures: false, usesBench: false };
    // Only a skipped or todo test may leave out its function.
    const mayLeaveOut = kind === 'test' && (names.has('skip') || names.has('todo'));
    // Bun wants a function second or third; a value that can't be one, as options alone, is none.
    const missing = body === undefined || isValue(body);
    if (missing && !spread && !mayLeaveOut) {
      const refusal = problem(
        'test-without-body',
        call,
        `${callee}() has no function, so Bun fails the file and runs none of its tests.`,
        callee,
      );
      return refused(call, refusal, context, () => declared);
    }
    if (run.retry && run.repeats !== undefined && atLeast(this.file.version, 1, 3)) {
      const refusal = problem(
        'invalid-chain',
        options as Argument,
        `${callee}() sets both retry and repeats, which Bun refuses from 1.3, so it fails the file and runs none of its tests.`,
        snippet(text(this.file, options as Argument)),
      );
      return refused(call, refusal, context, () => declared);
    }
    return declared;
  }

  /**
   * The states of a chain, as Bun ranks them: `skip` over `todo` over `failing`. `if(condition)` skips when the
   * condition is false; `skipIf`, `todoIf` and `failingIf` set theirs when it is true.
   */
  private states(links: Link[], line: number, context: CallContext): StateSetting[] {
    const setting = (state: StateSetting['state'], condition: string | null): StateSetting => ({
      state,
      condition,
      reason: null,
      hasDynamicReason: false,
      line,
    });
    const states: StateSetting[] = [];
    for (const link of links) {
      if (link.name === 'skip') states.push(setting('skip', null));
      else if (link.name === 'todo') states.push(setting('todo', null));
      else if (link.name === 'failing') states.push(setting('expectedToFail', null));
      if (!['if', 'skipIf', 'todoIf', 'failingIf'].includes(link.name)) continue;
      let condition = this.condition(link, context);
      if (link.name === 'if') condition = negated(condition);
      if (condition.applies === 'never') continue;
      const state = link.name === 'todoIf' ? 'todo' : link.name === 'failingIf' ? 'expectedToFail' : 'skip';
      states.push(setting(state, condition.applies === 'always' ? null : condition.text));
    }
    const rank = ['skip', 'todo', 'expectedToFail'];
    return states.sort((a, b) => rank.indexOf(a.state) - rank.indexOf(b.state));
  }

  /** `concurrent` runs the test with others at once, and `serial` alone, also as `concurrentIf` and `serialIf` that hold. */
  private mode(links: Link[], context: CallContext): Mode | null {
    for (const link of links) {
      const holds = !link.name.endsWith('If') || this.condition(link, context).applies === 'always';
      if (holds && (link.name === 'concurrent' || link.name === 'concurrentIf')) return 'parallel';
      if (holds && (link.name === 'serial' || link.name === 'serialIf')) return 'default';
    }
    return null;
  }

  /** A number as the timeout, or an object with `timeout`, `retry` and `repeats`. */
  private options(
    node: Argument | undefined,
    problems: Problem[],
    context: CallContext,
  ): { timeout?: number; retry?: { count: number; delay: null; condition: null }; repeats?: number } {
    const run: { timeout?: number; retry?: { count: number; delay: null; condition: null }; repeats?: number } = {};
    if (node === undefined || isFunctionLike(node)) return run;
    const expression = unwrap(node as Expression);
    const resolved = this.file.values.resolve(expression, context.scopes);
    if (resolved.ok && typeof resolved.value === 'number') {
      const value = readCount(this.file, 'timeout', { node: expression, resolved }, problems);
      if (value !== null) run.timeout = value;
      return run;
    }
    const read = readOptions(this.file, context.scopes, node);
    problems.push(...unresolvedOptions(this.file, read, 'its timeout, retry and repeats are missing'));
    for (const key of ['timeout', 'retry', 'repeats'] as const) {
      const option = read.values.get(key);
      const value = option ? readCount(this.file, key, option, problems) : null;
      if (value === null) continue;
      if (key === 'retry') run.retry = { count: value, delay: null, condition: null };
      else run[key] = value;
    }
    return run;
  }

  /** How many tests a table registers: one per item; null with a warning when the scan can't count them. */
  private caseCount(table: Link, problems: Problem[], context: CallContext): number | null {
    const cases = (table.args as Argument[]).at(0);
    const length = cases ? this.arrayLength(cases, context) : null;
    if (length === null && cases) {
      const source = snippet(text(this.file, cases));
      problems.push(
        problem('unresolved-cases', cases, 'The cases of .each() could not be counted; caseCount is null.', source),
      );
    }
    return length;
  }

  /** The cases of a table the scan can work out: an item that is an array is spread into the arguments, another is one. */
  private tableCases(table: Link, title: Title, context: CallContext): TableCase[] | null {
    const first = (table.args as Argument[]).at(0);
    const resolved = first && first.type !== 'SpreadElement' ? this.file.values.resolve(first, context.scopes) : null;
    if (!resolved?.ok || !Array.isArray(resolved.value)) return null;
    return resolved.value.map((item, index) => {
      const row = Array.isArray(item) ? item : [item];
      return { title: title.isDynamic ? null : bunCaseTitle(title.text, row, index, this.file.version), args: row };
    });
  }
}

function negated(condition: Condition): Condition {
  if (condition.applies === 'sometimes') return { applies: 'sometimes', text: `!(${condition.text})` };
  return { applies: condition.applies === 'always' ? 'never' : 'always', text: null };
}

function isFunctionLike(node: Argument | undefined): boolean {
  return node !== undefined && node.type !== 'SpreadElement' && isFunctionNode(unwrap(node));
}

/** Whether an argument is a value that can't be a function, as a literal or an object. */
function isValue(node: Argument): boolean {
  return ['Literal', 'ObjectExpression', 'ArrayExpression', 'TemplateLiteral'].includes(
    unwrap(node as Expression).type,
  );
}
