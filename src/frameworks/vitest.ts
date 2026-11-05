import type { Argument, CallExpression, Expression, Node, Program, TemplateLiteral } from 'oxc-parser';
import {
  childNodes,
  isFunctionNode,
  isImportMetaVitest,
  propertyKey,
  propertyName,
  unwrap,
  type FunctionNode,
} from '../ast.ts';
import type {
  ApiCall,
  CallContext,
  Condition,
  Details,
  Mode,
  ModuleReader,
  Problem,
  Span,
  StateOption,
  StateSetting,
  TableCase,
  Title,
} from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import { snippet } from '../source.ts';
import type { HookCounts, MetaValue } from '../types.ts';
import { vitestCaseTitle } from '../case-titles.ts';
import type { Value } from '../values.ts';
import {
  atLeast,
  hookFunction,
  problem,
  readChain,
  readCondition,
  destructuredNames,
  takesWhole,
  readCount,
  readOptions,
  readStrings,
  isTitleLiteral,
  readReason,
  namedFunction,
  origin,
  unresolvedOption,
  unresolvedOptions,
  readTitle,
  refused,
  text,
  type FileContext,
  type Link,
  type OptionValue,
} from './common.ts';
import { SuiteAdapter, type Dialect, type Kind } from './test-functions.ts';

const MODIFIERS: Record<Kind, Set<string>> = {
  test: new Set(['concurrent', 'sequential', 'only', 'skip', 'todo', 'fails']),
  describe: new Set(['concurrent', 'sequential', 'shuffle', 'skip', 'only', 'todo']),
};
const TABLES = new Set(['each', 'for']);
const CONDITIONS = new Set(['skipIf', 'runIf']);
const STATE_FLAGS: StateOption[] = ['only', 'todo', 'fails'];
const DERIVATIONS = new Set(['extend', 'override', 'scoped']);
/** Hooks, with the position of the test context among their callback's parameters. */
const HOOKS = new Map<keyof HookCounts, number | null>([
  ['beforeEach', 0],
  ['afterEach', 0],
  ['aroundEach', 1],
  ['beforeAll', null],
  ['afterAll', null],
  ['aroundAll', null],
]);

function isHook(name: string): name is keyof HookCounts {
  return HOOKS.has(name as keyof HookCounts);
}

/** First members of chains that never declare a test, even when Vitest refuses the rest of the chain. */
const NOT_DECLARING = new Set([...HOOKS.keys(), ...DERIVATIONS]);
/** First members that show a name imported from a local file is used as Vitest's `test`. */
const TEST_MEMBERS = [...MODIFIERS.test, ...MODIFIERS.describe, ...TABLES, ...CONDITIONS];

const VITEST: Dialect = {
  name: 'Vitest',
  source: 'vitest',
  mismatched: new Set(['@playwright/test', 'playwright/test', '@jest/globals']),
  starts: new Map([
    ['test', { kind: 'test', links: [] }],
    ['it', { kind: 'test', links: [] }],
    ['describe', { kind: 'describe', links: [] }],
    ['suite', { kind: 'describe', links: [] }],
  ]),
  hooks: new Map([...HOOKS.keys()].map((name) => [name, name])),
  derivations: DERIVATIONS,
  modifiers: new Set([...MODIFIERS.test, ...MODIFIERS.describe]),
  carriesKinds: true,
  isModule: isImportMetaVitest,
  defaultImport: "Vitest has no default export; import { test, describe } from 'vitest' instead.",
  required: 'Vitest cannot be loaded with require(); tests that use it are missing.',
};
/** Calls Vitest moves to the top of the file before running it: `vi.mock`, `vi.unmock` and `vi.hoisted`. */
const HOISTED_OBJECTS = new Set(['vi', 'vitest']);
const HOISTED_METHODS = new Set(['mock', 'unmock', 'hoisted']);

/**
 * The hoisted calls that are not written at the top level of the file, where Vitest moves them. Vitest 5 fails such a
 * file while it loads it. As in Vitest, `const value = vi.hoisted(...)` and `await vi.hoisted(...)` count as top
 * level, and a file with in-source tests is never checked.
 */
function nestedHoistedCalls(program: Program): CallExpression[] {
  if (hasInSourceTests(program)) return [];
  const topLevel = new Set<Node>(program.body);
  for (const statement of program.body) {
    if (statement.type === 'ExpressionStatement') topLevel.add(statement.expression);
  }
  const found: CallExpression[] = [];
  const parents: Node[] = [];
  const visit = (node: Node): void => {
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      const { object, property } = node.callee;
      const method = !node.callee.computed && property.type === 'Identifier' ? property.name : '';
      if (object.type === 'Identifier' && HOISTED_OBJECTS.has(object.name) && HOISTED_METHODS.has(method)) {
        if (!topLevel.has(method === 'hoisted' ? hoistedValue(node, parents) : node)) found.push(node);
      }
    }
    parents.push(node);
    for (const child of childNodes(node)) visit(child);
    parents.pop();
  };
  visit(program);
  return found;
}

/** Whether the file has in-source tests, which read `import.meta.vitest`. */
function hasInSourceTests(node: Node): boolean {
  return (node.type === 'MemberExpression' && isImportMetaVitest(node)) || childNodes(node).some(hasInSourceTests);
}

/** What Vitest moves for a `vi.hoisted` call: the declaration it initializes, the `await` around it, or the call. */
function hoistedValue(call: CallExpression, parents: readonly Node[]): Node {
  const declaration = parents.findLast((node) => node.type === 'VariableDeclaration');
  const init = declaration?.type === 'VariableDeclaration' ? declaration.declarations[0]?.init : null;
  const value = init ? unwrap(init) : null;
  if (declaration && (value === call || (value?.type === 'AwaitExpression' && unwrap(value.argument) === call))) {
    return declaration;
  }
  const parent = parents.at(-1);
  return parent?.type === 'AwaitExpression' ? parent : call;
}

/** The names through which a test or hook body can skip its test: `context.skip()` or a destructured `skip()`. */
/** The names a test or hook function gives its context, and the context functions it takes out of it. */
interface ContextNames {
  objects: Set<string>;
  skip: Set<string>;
  annotate: Set<string>;
}

/** Keys of the test context that Vitest provides itself, with the version that added each; they are not fixtures. */
const CONTEXT_KEYS = new Map<string, [number, number]>([
  ['task', [3, 0]],
  ['expect', [3, 0]],
  ['skip', [3, 0]],
  ['onTestFailed', [3, 0]],
  ['onTestFinished', [3, 0]],
  ['annotate', [3, 2]],
  ['signal', [3, 2]],
  ['bench', [5, 0]],
]);

function fixturesOf(fn: FunctionNode | null, index: number | null, version: [number, number] | null): string[] {
  return destructuredNames(fn, index).filter((name) => {
    const since = CONTEXT_KEYS.get(name);
    return !since || !atLeast(version, ...since);
  });
}

/**
 * The `skip` option a describe passes down, with the line that sets it: its own, or the one passed down to it.
 * `covered` is set when a describe there is skipped already, which skips what is inside.
 */
interface PassedSkip {
  condition: Condition;
  line: number;
  covered: boolean;
}

/**
 * Whether a member of `test` or `describe` reads the function it is called on through `this`, so that it throws when
 * destructured, as each version of Vitest runs it (checked with 3.2.4, 4.0.18, 4.1.12, 5.0.0 and 5.1.0).
 */
function readsItsFunction(kind: Kind, member: string, version: [number, number] | null): boolean {
  if (kind === 'describe') return member === 'each' || (member === 'for' && atLeast(version, 5, 0));
  if (['each', 'for', 'skipIf', 'runIf'].includes(member)) return true;
  return ['extend', 'scoped', 'override'].includes(member) && atLeast(version, 4, 1);
}

export class VitestAdapter extends SuiteAdapter {
  private warnedAboutTags = false;

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    super(parsed, file, readModule, VITEST, TEST_MEMBERS);
    if (atLeast(file.version, 5, 0)) {
      for (const call of nestedHoistedCalls(parsed.program)) {
        const callee = snippet(text(this.file, call.callee));
        this.problems.push(
          problem(
            'removed-api',
            call,
            `Vitest 5 fails a file that calls ${callee}(...) anywhere but its top level, because the call is hoisted there.`,
            callee,
          ),
        );
      }
    }
    if (atLeast(file.version, 4, 1)) {
      // Vitest's own pattern, over the whole text as Vitest reads it, so the same tags come out.
      for (const match of parsed.source.text.matchAll(/(\/\/|\*)\s*@module-tag\s+([\w\-/]+)\b/g)) {
        const span = { start: match.index, end: match.index + match[0].length };
        this.fileTags.push(match[2]);
        this.fileTagSpans.push(span);
        this.tagsUsed(span);
      }
    }
  }

  protected isAliasLink(kind: Kind, link: Link): boolean {
    return MODIFIERS[kind].has(link.name) || TABLES.has(link.name) || CONDITIONS.has(link.name);
  }

  classify(call: CallExpression, context: CallContext): ApiCall | null {
    return (
      this.benchCall(call, context) ??
      this.hookCall(call, context) ??
      this.contextSkip(call, context) ??
      this.unboundCall(call, context) ??
      this.chainCall(call, context)
    );
  }

  /** A call to `bench` imported from Vitest 5, which is undefined there, so the call throws. */
  private benchCall(call: CallExpression, context: CallContext): ApiCall | null {
    const base = readChain(call.callee)?.base;
    if (base?.type !== 'Identifier' || this.bindings.members.get(base.name) !== 'bench') return null;
    if (!atLeast(this.file.version, 5, 0)) return null;
    const declaration = this.file.values.declarationOf(base.name, context.scopes);
    if (declaration === null || !this.bindings.declarations.has(declaration)) return null;
    const callee = snippet(text(this.file, call.callee));
    return {
      kind: 'invalid',
      problem: problem(
        'removed-api',
        call,
        `Vitest 5 no longer exports bench from 'vitest'; ${callee}(...) fails. Benchmarks are not tests.`,
        callee,
      ),
    };
  }

  /**
   * A call of a member Vitest calls on its test or describe function, destructured from it, as `each` in
   * `const { each } = test`: the member reads the function it is called on, which a plain call doesn't give it, so the
   * call throws while the file loads. Which members do that depends on the version.
   */
  private unboundCall(call: CallExpression, context: CallContext): ApiCall | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'Identifier') return null;
    const found = this.destructuredMember(callee.name, context);
    if (!found || !readsItsFunction(found.kind, found.member, this.file.version)) return null;
    const from = snippet(text(this.file, found.from));
    const message = `${callee.name} is destructured from ${from}, so it loses the test object it reads, and Vitest fails the file.`;
    return { kind: 'invalid', problem: problem('invalid-chain', call, message, callee.name) };
  }

  private chainCall(call: CallExpression, context: CallContext): ApiCall | null {
    const chain = readChain(call.callee);
    const resolved = chain ? this.resolve(chain, call.arguments, context) : null;
    if (!resolved) return null;
    const { kind, links } = resolved;
    if (kind === 'test' && links.length === 1 && isHook(links[0].name)) return this.hook(call, links[0].name, context);
    if (links.length === 1 && DERIVATIONS.has(links[0].name)) return { kind: 'other' };
    const last = links.at(-1);
    if (last && (TABLES.has(last.name) || CONDITIONS.has(last.name)) && !last.args && !last.template) {
      return { kind: 'other' };
    }
    const callee = snippet(text(this.file, call.callee));
    const removed = (link: Link) => link.name === 'sequential' && atLeast(this.file.version, 5, 0);
    const valid = (link: Link) => {
      const called = link.args !== null || link.template !== null;
      if (MODIFIERS[kind].has(link.name)) return !called && !removed(link);
      return TABLES.has(link.name) ? called : CONDITIONS.has(link.name) && link.args !== null;
    };
    const invalid = links.find((link) => !valid(link));
    if (!invalid) return this.declaration(call, kind, links, context);
    const refusal = removed(invalid)
      ? problem('removed-api', call, `sequential was removed in Vitest 5; ${callee}(...) fails.`, callee)
      : problem('invalid-chain', call, `${callee} is not part of Vitest's API.`, callee);
    if (NOT_DECLARING.has(links[0].name)) return { kind: 'invalid', problem: refusal };
    // Which of its parts the chain means is not known, so it declares a plain test or describe.
    return refused(call, refusal, context, () => this.declaration(call, kind, [], context));
  }

  protected hook(call: CallExpression, name: keyof HookCounts, context: CallContext): ApiCall {
    const fn = hookFunction(this.file, context.scopes, call.arguments);
    const index = HOOKS.get(name) as number | null;
    return {
      kind: 'hook',
      name,
      fn,
      testContext: index === null ? null : contextNames(fn, index),
      fixtures: fixturesOf(fn, index, this.file.version),
      takesAllFixtures: takesWhole(fn, index),
    };
  }

  private contextSkip(call: CallExpression, context: CallContext): ApiCall | null {
    const names = context.testContext as ContextNames | null;
    if (!names) return null;
    if (atLeast(this.file.version, 3, 2) && callsContext(call, names, 'annotate')) return this.annotate(call, context);
    if (!callsContext(call, names, 'skip')) return null;
    const [first, second] = call.arguments;
    // skip(), skip(note) or skip(condition, note); before Vitest 3.1 the first argument is always the note.
    const noteOnly = !atLeast(this.file.version, 3, 1) || (call.arguments.length === 1 && isTitleLiteral(first));
    const reason = readReason(this.file, context.scopes, noteOnly ? first : second);
    return {
      kind: 'modifier',
      state: 'skip',
      condition: noteOnly ? { applies: 'always', text: null } : readCondition(this.file, context.scopes, first),
      reason: reason.reason,
      hasDynamicReason: reason.isDynamic,
      problems: reason.problem ? [reason.problem] : [],
    };
  }
  /**
   * `annotate(message, type?)` from the test context (3.2), as an annotation of type `notice` when no type is given; the
   * second argument may also be an attachment.
   */
  private annotate(call: CallExpression, context: CallContext): ApiCall {
    const args = call.arguments.map((arg) =>
      arg.type === 'SpreadElement' ? null : this.file.values.resolve(arg, context.scopes),
    );
    const [message, second] = args;
    // A second argument that isn't a string is an attachment, given in place of the type.
    let type: string | null = 'notice';
    if (args.length > 1 && !second?.ok) type = null;
    else if (second?.ok && typeof second.value === 'string') type = second.value;
    if (message?.ok && typeof message.value === 'string' && type !== null) {
      const annotation = { type, description: message.value, lineStart: this.file.source.line(call.start) };
      return { kind: 'annotations', items: [annotation], problems: [] };
    }
    const source = snippet(text(this.file, call));
    const unresolved = [message, second].find((item) => item && !item.ok);
    const from = unresolved && !unresolved.ok ? unresolved.importedFrom : null;
    const missing = problem(
      'unresolved-annotation',
      call,
      `Annotation ${source}${origin(from)} could not be worked out; it is missing.`,
      source,
    );
    return { kind: 'annotations', items: [], problems: [missing] };
  }

  private declaration(call: CallExpression, kind: Kind, links: Link[], context: CallContext): ApiCall {
    const args = call.arguments;
    const callee = snippet(text(this.file, call.callee));
    if (args.length === 0) return { kind: 'other' };
    if (kind === 'describe' && isFunctionNode(args[0])) {
      return {
        kind: 'invalid',
        problem: problem(
          'describe-not-called',
          call,
          `${callee}() has no title, so Vitest never calls its function.`,
          callee,
        ),
      };
    }
    const problems: Problem[] = [];
    const { title, problem: titleProblem } = readTitle(this.file, context.scopes, args[0], {
      stripTags: false,
      functionNames: true,
    });
    if (titleProblem) problems.push(titleProblem);
    // (title, fn, timeout), (title, options, fn) or the removed (title, fn, options)
    let options: Argument | undefined;
    let body: Argument | undefined;
    let timeout: Argument | undefined;
    let refusal: Problem | null = null;
    const [second, third] = [args.at(1), args.at(2)];
    if (args.some((arg) => arg.type === 'SpreadElement')) {
      // With spread arguments, as in test(...args), the function and options are unknown.
      body = args[0];
    } else if (second !== undefined && this.isOptions(second, third, context)) {
      [options, body] = [second, third];
    } else {
      body = second;
      if (third !== undefined && this.isOptions(third, undefined, context)) {
        if (atLeast(this.file.version, 4, 0)) {
          refusal = problem(
            'removed-api',
            third,
            `${callee}() takes options as its second argument since Vitest 4; with options third the call fails.`,
            snippet(text(this.file, third)),
          );
        }
        options = third;
      } else if (
        third === undefined ||
        isFunctionNode(second) ||
        namedFunction(this.file, context.scopes, second) ||
        this.file.values.resolve(third as Expression, context.scopes).ok
      ) {
        // With imported options and a body passed by name, either could be the body, so the third is no timeout.
        timeout = third;
      }
    }
    const fn = isFunctionNode(body) ? body : null;
    const read = this.readDeclarationOptions(options, context, problems);
    if (timeout) {
      const node = timeout as Expression;
      const option = { node, resolved: this.file.values.resolve(node, context.scopes) };
      const value = readCount(this.file, 'timeout', option, problems);
      if (value !== null) read.details.run.timeout = value;
    }
    const chain = new Set(links.filter((link) => MODIFIERS[kind].has(link.name)).map((link) => link.name));
    const flags = new Set(chain);
    let conditions = links.filter((link) => CONDITIONS.has(link.name)).map((link) => this.linkCondition(link, context));
    // From Vitest 5.0.5 a test's `skip`, `skipIf` and `runIf` each set its `skip`, so the last of them decides, and a
    // `skipIf` or `runIf` replaces the skip of a tag or of a describe around. The scan applies that to all of Vitest 5.
    const lastSkip = links.filter((link) => link.name === 'skip' || CONDITIONS.has(link.name)).at(-1);
    const skipsByChain = kind === 'test' && lastSkip !== undefined && atLeast(this.file.version, 5, 0);
    const conditionSetsSkip = skipsByChain && CONDITIONS.has(lastSkip.name);
    if (skipsByChain) {
      flags.delete('skip');
      conditions = conditionSetsSkip ? [this.linkCondition(lastSkip, context)] : [];
      if (!conditionSetsSkip) flags.add('skip');
    }
    // A test's own options win over its chain, so `test.skip('title', { skip: false }, fn)` runs. The chain wins for a
    // test's mode, and for everything on a describe.
    for (const [flag, value] of read.flags) {
      if (value) flags.add(flag);
      else if (kind === 'test' && flag !== 'sequential') flags.delete(flag);
    }
    if (read.skip && kind === 'test') {
      flags.delete('skip');
      conditions = [read.skip];
    } else if (read.skip) {
      conditions.push(read.skip);
    }
    // Vitest passes a describe's options down to the tests and describes inside, where their own options and `only`
    // win. A `skip` passed down skips them, and turns todo into skip, as skip goes before todo.
    const line = this.file.source.line(call.start);
    const around = context.passedDown as PassedSkip | null;
    const passed = read.skip || conditionSetsSkip ? null : around;
    const skips = passed?.condition.applies === 'always' && !flags.has('only');
    const table = links.find((link) => TABLES.has(link.name)) ?? null;
    const isTodo = flags.has('todo') || body === undefined;
    const states = this.states(flags, conditions, isTodo && !skips, line);
    const skipped = () => states.some((setting) => setting.state === 'skip' && !setting.condition);
    // The skip is set where the describe that passes it down sets it. A skipped describe around already skips what is
    // inside, as it does when its own `only` beats its skip; a todo describe gets the skip itself.
    if (skips && !skipped() && (!passed.covered || (kind === 'describe' && isTodo))) {
      states.push({ state: 'skip', condition: null, reason: null, hasDynamicReason: false, line: passed.line });
    }
    // The chain's mode wins over the options'. `{ concurrent: false }` is how Vitest 5 turns parallel off, in place of
    // `sequential`.
    const parallel = chain.has('concurrent') || (!chain.has('sequential') && read.concurrent === true);
    const mode: Mode | null = parallel
      ? 'parallel'
      : flags.has('sequential') || read.concurrent === false
        ? 'default'
        : null;
    const base = {
      title,
      states,
      isOnly: flags.has('only'),
      mode,
      ...(skips ? { skipPassedDown: passed.line } : {}),
      details: read.details,
      fn,
      hashed: fn ?? namedFunction(this.file, context.scopes, body),
      isParameterized: table !== null,
      caseCount: table ? this.caseCount(call, table, context, problems) : null,
      cases: table ? this.tableCases(table, title, context) : null,
      problems,
    };
    let declared: ApiCall;
    if (kind === 'describe') {
      // A table's cases are passed instead.
      const first = table ? null : fn?.params.at(0);
      if (fn && first?.type === 'Identifier') this.suiteParameters.set(fn, first.name);
      const own = read.skip ? { condition: read.skip, line } : around;
      const passesDown: PassedSkip | null = own && { ...own, covered: (around?.covered ?? false) || skipped() };
      declared = { kind: 'describe', ...base, isShuffled: flags.has('shuffle'), passesDown };
    } else {
      const index = table?.name === 'for' ? 1 : table ? null : 0;
      declared = {
        kind: 'test',
        ...base,
        testContext: contextNames(base.hashed, index),
        fixtures: fixturesOf(base.hashed, index, this.file.version),
        takesAllFixtures: takesWhole(base.hashed, index),
        usesBench: atLeast(this.file.version, 5, 0) && destructuredNames(base.hashed, index).includes('bench'),
        ownStateOptions: [
          ...(read.skip || conditionSetsSkip ? ['skip' as const] : []),
          ...STATE_FLAGS.filter((flag) => read.flags.has(flag)),
        ],
      };
    }
    return refusal ? refused(call, refusal, context, () => declared) : declared;
  }

  /** Whether an argument holds options: an object, a name for one, or anything but a function before the body. */
  private isOptions(node: Argument, next: Argument | undefined, context: CallContext): boolean {
    // Spread arguments were handled before, so this is an expression.
    const expression = unwrap(node as Expression);
    if (expression.type === 'ObjectExpression') return true;
    if (isFunctionNode(expression)) return false;
    // `test('backtests a year', SLOW, () => {})`: before the body it is options, even when imported.
    if (isFunctionNode(next)) return true;
    if (expression.type !== 'Identifier' && expression.type !== 'MemberExpression') return false;
    const resolved = this.file.values.resolve(expression, context.scopes);
    return (
      resolved.ok && typeof resolved.value === 'object' && resolved.value !== null && !Array.isArray(resolved.value)
    );
  }

  private linkCondition(link: Link, context: CallContext): Condition {
    const condition = readCondition(this.file, context.scopes, (link.args as Argument[])[0]);
    if (link.name === 'skipIf') return condition;
    // runIf(condition) skips when the condition is false.
    if (condition.applies !== 'sometimes')
      return { applies: condition.applies === 'always' ? 'never' : 'always', text: null };
    return { applies: 'sometimes', text: `!(${condition.text})` };
  }

  /** Vitest's order: `only` wins over `skip`, which wins over `todo`. */
  private states(flags: Set<string>, conditions: Condition[], isTodo: boolean, line: number): StateSetting[] {
    const setting = (state: StateSetting['state'], condition: string | null = null): StateSetting[] => [
      { state, condition, reason: null, hasDynamicReason: false, line },
    ];
    const fails = flags.has('fails') ? setting('expectedToFail') : [];
    if (flags.has('only')) return fails;
    const skip = (condition: string | null) => setting('skip', condition);
    if (flags.has('skip') || conditions.some((condition) => condition.applies === 'always')) return skip(null);
    if (isTodo) return setting('todo');
    const sometimes = conditions.filter((condition) => condition.applies === 'sometimes');
    if (sometimes.length > 0) return skip(sometimes.map((condition) => condition.text).join(' || '));
    return fails;
  }

  private readDeclarationOptions(
    node: Argument | undefined,
    context: CallContext,
    problems: Problem[],
  ): { flags: Map<string, boolean>; concurrent: boolean | null; skip: Condition | null; details: Details } {
    const details: Details = { tags: [], annotations: [], locks: [], meta: null, run: {} };
    const result = {
      flags: new Map<string, boolean>(),
      concurrent: null as boolean | null,
      skip: null as Condition | null,
      details,
    };
    if (!node) return result;
    const options = readOptions(this.file, context.scopes, node);
    problems.push(...unresolvedOptions(this.file, options, 'its flags, tags and meta are missing'));
    // From Vitest 5.0.5 an option set to `undefined` replaces nothing; the scan applies that to all of Vitest 5.
    const given = (key: string) => {
      const option = options.values.get(key);
      const isUndefined = option?.resolved.ok === true && option.resolved.value === undefined;
      return isUndefined && atLeast(this.file.version, 5, 0) ? undefined : option;
    };
    for (const flag of ['only', 'todo', 'fails', 'concurrent', 'sequential', 'shuffle']) {
      const option = given(flag);
      if (option && !option.resolved.ok) {
        const { importedFrom } = option.resolved;
        problems.push(unresolvedOption(this.file, flag, option.node, importedFrom, 'it is not applied'));
      } else if (option?.resolved.ok && flag === 'concurrent') {
        result.concurrent = Boolean(option.resolved.value);
      } else if (option?.resolved.ok) {
        result.flags.set(flag, Boolean(option.resolved.value));
      }
    }
    const skip = given('skip');
    if (skip) {
      result.skip = skip.resolved.ok
        ? { applies: skip.resolved.value ? 'always' : 'never', text: null }
        : { applies: 'sometimes', text: snippet(text(this.file, skip.node)) };
    }
    const tags = options.values.get('tags');
    if (tags && atLeast(this.file.version, 4, 1)) {
      const read = readStrings(this.file, context.scopes, tags);
      details.tags.push(...read.values);
      this.tagsUsed(tags.node);
      for (const { node: unresolved, importedFrom } of read.unresolved) {
        const source = snippet(text(this.file, unresolved));
        problems.push(
          problem(
            'unresolved-tag',
            unresolved,
            `Tag value ${source}${origin(importedFrom)} could not be worked out; the tag is missing.`,
            source,
          ),
        );
      }
    }
    const meta = options.values.get('meta');
    if (meta) details.meta = this.meta(meta, context, problems);
    for (const key of ['timeout', 'repeats'] as const) {
      const option = given(key);
      const value = option ? readCount(this.file, key, option, problems) : null;
      if (value !== null) details.run[key] = value;
    }
    const retry = given('retry');
    if (retry) this.retry(retry, details, context, problems);
    return result;
  }

  /** `retry` as a number, or since Vitest 4.1 as `{ count, delay, condition }`. */
  private retry(option: OptionValue, details: Details, context: CallContext, problems: Problem[]): void {
    const node = unwrap(option.node);
    if (node.type !== 'ObjectExpression') {
      const count = readCount(this.file, 'retry', option, problems);
      if (count !== null) details.run.retry = { count, delay: null, condition: null };
      return;
    }
    if (!atLeast(this.file.version, 4, 1)) {
      // Before 4.1 the runner compares the attempt number with the object, so it never runs the test.
      const source = snippet(text(this.file, node));
      const message = `Option retry: ${source} is an object, which Vitest reads from 4.1; before, it never runs the test.`;
      problems.push(problem('unresolved-option', node, message, source));
      details.run.retry = null;
      return;
    }
    const values = readOptions(this.file, context.scopes, node);
    problems.push(...unresolvedOptions(this.file, values, 'the retry is not applied'));
    const read = (key: string) => {
      const value = values.values.get(key);
      return value ? readCount(this.file, `retry.${key}`, value, problems) : undefined;
    };
    const count = read('count');
    const delay = read('delay');
    if (count === null) return;
    const condition = values.values.get('condition');
    details.run.retry = {
      // Vitest retries 0 times when the object has no count.
      count: count ?? 0,
      delay: delay ?? null,
      condition: condition ? snippet(text(this.file, condition.node)) : null,
    };
  }

  private meta(option: OptionValue, context: CallContext, problems: Problem[]): Record<string, MetaValue> | null {
    const entries = readOptions(this.file, context.scopes, option.node);
    problems.push(...unresolvedOptions(this.file, entries, 'its meta values are missing'));
    const meta: Record<string, MetaValue> = {};
    for (const [key, value] of entries.values) {
      if (value.resolved.ok && isMetaValue(value.resolved.value)) {
        meta[key] = value.resolved.value;
      } else if (!value.resolved.ok) {
        const { importedFrom } = value.resolved;
        problems.push(unresolvedOption(this.file, `meta.${key}`, value.node, importedFrom, 'the value is missing'));
      }
    }
    return Object.keys(meta).length > 0 ? meta : null;
  }

  private caseCount(call: CallExpression, table: Link, context: CallContext, problems: Problem[]): number | null {
    const cases = table.template ?? (table.args as Argument[]).at(0);
    const count = table.template ? templateRows(table.template) : this.arrayLength(cases, context);
    if (count === null) {
      const node = cases ?? call.callee;
      problems.push(
        problem(
          'unresolved-cases',
          node,
          `The cases of .${table.name}() could not be counted; caseCount is null.`,
          snippet(text(this.file, node)),
        ),
      );
    }
    return count;
  }

  /**
   * The cases of a table whose values the scan can work out, as Vitest passes them: `.each` spreads a case that is an
   * array into the callback's arguments when every case is one, and `.for` passes each case whole. A tagged template
   * gives one object per row, keyed by the names in its first line.
   */
  private tableCases(table: Link, title: Title, context: CallContext): TableCase[] | null {
    let cases: Value[];
    if (table.template) {
      const values = table.template.expressions.map((item) => this.file.values.resolve(item, context.scopes));
      if (!values.every((item) => item.ok)) return null;
      const header = templateHeader(table.template);
      // Without values, Vitest passes the template's strings as the table.
      cases =
        values.length === 0
          ? table.template.quasis.map((quasi) => quasi.value.cooked ?? undefined)
          : Array.from({ length: Math.floor(values.length / header.length) }, (_, row) =>
              Object.fromEntries(header.map((name, column) => [name, values[row * header.length + column].value])),
            );
    } else {
      const first = (table.args as Argument[]).at(0);
      const resolved = first && first.type !== 'SpreadElement' ? this.file.values.resolve(first, context.scopes) : null;
      if (!resolved?.ok || !Array.isArray(resolved.value)) return null;
      cases = resolved.value;
    }
    const caseTitle = (items: Value[], index: number) =>
      title.isDynamic ? null : vitestCaseTitle(title.text, items, index, this.file.version);
    if (table.name === 'for') {
      return cases.map((item, index) => ({
        title: caseTitle(item === null || item === undefined ? [] : Array.isArray(item) ? item : [item], index),
        args: [item],
      }));
    }
    const arraysOnly = cases.every((item) => Array.isArray(item));
    return cases.map((item, index) => {
      const items = Array.isArray(item) ? item : [item];
      return { title: caseTitle(items, index), args: arraysOnly ? items : [item] };
    });
  }

  private tagsUsed(node: Span): void {
    if (this.warnedAboutTags) return;
    this.warnedAboutTags = true;
    this.problems.push(
      problem(
        'config-may-change-state',
        node,
        "The file uses Vitest tags, and tags defined in the Vitest config can skip tests or change how they run; the scan can't work out the config's tags.",
      ),
    );
  }
}

/**
 * The column names of a tagged-template table such as ``each`side | qty ${'buy'} | ${100}` ``, as Vitest's
 * `formatTemplateString` reads them: the text of the template with its spaces taken out, its first line split at `|`.
 * Outer pipes, as in `| side | qty |`, give empty names too.
 */
function templateHeader(template: TemplateLiteral): string[] {
  // A string with an invalid escape, as in `\xZZ`, has no cooked value, which joins as nothing.
  const strings = template.quasis.map((quasi) => quasi.value.cooked ?? '');
  return strings.join('').trim().replace(/ /g, '').split('\n')[0].split('|');
}

/**
 * Rows of a tagged-template table: as many as the values fill, an incomplete last row left out, as Vitest does. A
 * template without values isn't split, so its text is the one case.
 */
function templateRows(template: TemplateLiteral): number {
  if (template.expressions.length === 0) return 1;
  return Math.floor(template.expressions.length / templateHeader(template).length);
}

function isMetaValue(value: Value): value is MetaValue {
  return value !== undefined;
}

function contextNames(fn: FunctionNode | null, index: number | null): ContextNames | null {
  const parameter = index === null ? undefined : fn?.params[index];
  if (!parameter) return null;
  const names: ContextNames = { objects: new Set(), skip: new Set(), annotate: new Set() };
  if (parameter.type === 'Identifier') names.objects.add(parameter.name);
  if (parameter.type === 'ObjectPattern') {
    for (const property of parameter.properties) {
      const key = property.type === 'Property' ? propertyKey(property) : null;
      if (
        (key === 'skip' || key === 'annotate') &&
        property.type === 'Property' &&
        property.value.type === 'Identifier'
      ) {
        names[key].add(property.value.name);
      }
    }
  }
  return names;
}

/** Whether a call is `name(...)` for a context function taken out of the context, or `context.name(...)`. */
function callsContext(call: CallExpression, names: ContextNames, member: 'skip' | 'annotate'): boolean {
  const callee = unwrap(call.callee);
  return callee.type === 'Identifier'
    ? names[member].has(callee.name)
    : callee.type === 'MemberExpression' &&
        propertyName(callee) === member &&
        callee.object.type === 'Identifier' &&
        names.objects.has(callee.object.name);
}
