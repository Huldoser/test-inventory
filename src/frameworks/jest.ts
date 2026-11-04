import type { Argument, CallExpression, Expression, Node, TemplateLiteral } from 'oxc-parser';
import { isFunctionNode, propertyName, returnValues, unwrap, type FunctionNode } from '../ast.ts';
import { jestKeysTitle, jestRowTitle } from '../case-titles.ts';
import type { ApiCall, CallContext, ModuleReader, Problem, StateSetting, TableCase, Title } from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import { snippet } from '../source.ts';
import type { HookCounts } from '../types.ts';
import type { Value } from '../values.ts';
import { requiredModule } from './bindings.ts';
import {
  atLeast,
  findFunction,
  hookFunction,
  namedFunction,
  problem,
  readChain,
  readCount,
  readOptions,
  readTitle,
  refused,
  text,
  type FileContext,
  type Link,
} from './common.ts';
import { SuiteAdapter, type Dialect, type Kind } from './test-functions.ts';

const SOURCE = '@jest/globals';

const JEST: Dialect = {
  name: 'Jest',
  source: SOURCE,
  mismatched: new Set(['@playwright/test', 'playwright/test', 'vitest']),
  starts: new Map([
    ['test', { kind: 'test', links: [] }],
    ['it', { kind: 'test', links: [] }],
    ['describe', { kind: 'describe', links: [] }],
    ['fit', { kind: 'test', links: ['only'] }],
    ['xit', { kind: 'test', links: ['skip'] }],
    ['xtest', { kind: 'test', links: ['skip'] }],
    ['fdescribe', { kind: 'describe', links: ['only'] }],
    ['xdescribe', { kind: 'describe', links: ['skip'] }],
  ]),
  hooks: new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']),
  derivations: new Set(),
  modifiers: new Set(['only', 'skip', 'todo', 'concurrent', 'failing']),
  carriesKinds: false,
  isModule: (expression) => requiredModule(expression) === SOURCE,
  // Babel and TypeScript give a default import of the CommonJS module the whole module.
  defaultImport: null,
  required: null,
};

/**
 * The chains Jest's `test` and `describe` have, read from `jest-circus` 29.0, 29.7 and 30.5, where they are the same.
 * Each is a fixed path: `test.concurrent.only` exists, `test.only.concurrent` doesn't.
 */
const CHAINS: Record<Kind, ReadonlySet<string>> = {
  test: new Set(
    [
      '',
      'only',
      'skip',
      'todo',
      'concurrent',
      'concurrent.only',
      'concurrent.skip',
      'failing',
      'only.failing',
      'skip.failing',
      'concurrent.failing',
      'concurrent.only.failing',
      'concurrent.skip.failing',
    ].flatMap((chain) => (chain === 'todo' ? [chain] : [chain, chain === '' ? 'each' : `${chain}.each`])),
  ),
  describe: new Set(['', 'only', 'skip', 'each', 'only.each', 'skip.each']),
};
const MODIFIERS = new Set(['only', 'skip', 'todo', 'concurrent', 'failing', 'each']);

export class JestAdapter extends SuiteAdapter {
  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    super(parsed, file, readModule, JEST, MODIFIERS);
    const { text: source } = parsed.source;
    let from = 0;
    for (const group of groups(source)) {
      const start = source.indexOf('@group', from);
      from = start + 1;
      this.fileTags.push(group);
      this.fileTagSpans.push({ start, end: start + '@group'.length });
    }
  }

  classify(call: CallExpression, context: CallContext): ApiCall | null {
    return this.retryCall(call, context) ?? this.hookCall(call, context) ?? this.chainCall(call, context);
  }

  protected isAliasLink(_kind: Kind, link: Link): boolean {
    return MODIFIERS.has(link.name);
  }

  protected hook(call: CallExpression, name: keyof HookCounts, context: CallContext): ApiCall {
    const fn = hookFunction(this.file, context.scopes, call.arguments);
    return { kind: 'hook', name, fn, testContext: null, fixtures: [], takesAllFixtures: false };
  }

  /**
   * `jest.retryTimes(n, options)`. Jest keeps one count for the file and reads it as each test runs, so the last call
   * made while the file loads applies to every test, wherever it is written. From 30.5, `entireDescribe` keeps the
   * count for the describe it is called in instead, and retries the describe as a whole.
   */
  private retryCall(call: CallExpression, context: CallContext): ApiCall | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'MemberExpression' || propertyName(callee) !== 'retryTimes') return null;
    if (!this.isJest(callee.object, context)) return null;
    if (context.inBody) return { kind: 'other' };
    const problems: Problem[] = [];
    const [count, options] = [call.arguments.at(0), call.arguments.at(1)];
    if (!count || count.type === 'SpreadElement') return { kind: 'other' };
    const option = { node: count, resolved: this.file.values.resolve(count, context.scopes) };
    const retries = readCount(this.file, 'retryTimes', option, problems);
    let delay: number | null = null;
    let entireDescribe = false;
    if (options && options.type !== 'SpreadElement') {
      const values = readOptions(this.file, context.scopes, options).values;
      const wait = values.get('waitBeforeRetry');
      if (wait && atLeast(this.file.version, 30, 0)) delay = readCount(this.file, 'waitBeforeRetry', wait, problems);
      const entire = values.get('entireDescribe')?.resolved;
      entireDescribe = atLeast(this.file.version, 30, 5) && entire?.ok === true && entire.value === true;
    }
    const retry = retries === null ? null : { count: retries, delay, condition: null };
    if (entireDescribe) return { kind: 'configure', mode: null, locks: [], run: { retry }, problems };
    const argument = snippet(text(this.file, count));
    return { kind: 'run', settings: { retry }, argument, problems, fileWide: true };
  }

  /** Whether an expression is Jest's `jest` object: the global, a name imported from Jest, or a member of the module. */
  private isJest(expression: Expression, context: CallContext): boolean {
    const node = unwrap(expression);
    if (node.type === 'MemberExpression')
      return propertyName(node) === 'jest' && this.bindings.isNamespace(node.object);
    if (node.type !== 'Identifier') return false;
    const declaration = this.file.values.declarationOf(node.name, context.scopes);
    if (declaration === null) return node.name === 'jest';
    return this.bindings.declarations.has(declaration) && this.bindings.members.get(node.name) === 'jest';
  }

  private chainCall(call: CallExpression, context: CallContext): ApiCall | null {
    const chain = readChain(call.callee);
    const resolved = chain ? this.resolve(chain, call.arguments, context) : null;
    if (!resolved) return null;
    const { kind, links } = resolved;
    const last = links.at(-1);
    if (last?.name === 'each' && !last.args && !last.template) return { kind: 'other' };
    const isTable = (link: Link, index: number) => link.name === 'each' && index === links.length - 1;
    const called = (link: Link) => link.args !== null || link.template !== null;
    const path = links.map((link) => link.name).join('.');
    const valid = CHAINS[kind].has(path) && links.every((link, index) => called(link) === isTable(link, index));
    if (valid) return this.declaration(call, kind, links, context);
    const callee = snippet(text(this.file, call.callee));
    const refusal = problem(
      'invalid-chain',
      call,
      `${callee} is not part of Jest's API; the call throws, and Jest fails the file.`,
      callee,
    );
    // Which of its parts the chain means is not known, so it declares a plain test or describe.
    return refused(call, refusal, context, () => this.declaration(call, kind, [], context));
  }

  private declaration(call: CallExpression, kind: Kind, links: Link[], context: CallContext): ApiCall {
    const args = call.arguments;
    if (args.length === 0) return { kind: 'other' };
    const callee = snippet(text(this.file, call.callee));
    const flags = new Set(links.map((link) => link.name));
    const problems: Problem[] = [];
    const { title, problem: titleProblem } = readTitle(this.file, context.scopes, args[0], {
      stripTags: false,
      functionNames: true,
    });
    if (titleProblem) problems.push(titleProblem);
    const spread = args.some((arg) => arg.type === 'SpreadElement');
    const body = spread ? undefined : args.at(1);
    const fn = isFunctionNode(body) ? body : null;
    const table = links.find((link) => link.name === 'each') ?? null;
    const line = this.file.source.line(call.start);
    const declared = (given: FunctionNode | null = fn): ApiCall => {
      const base = {
        title,
        states: this.states(flags, line),
        isOnly: flags.has('only'),
        mode: flags.has('concurrent') && !flags.has('skip') ? ('parallel' as const) : null,
        details: { tags: [], annotations: [], locks: [], meta: null, run: {} },
        fn: given,
        hashed: given ?? namedFunction(this.file, context.scopes, body),
        isParameterized: table !== null,
        caseCount: table ? this.caseCount(table, context, problems) : null,
        cases: table ? this.tableCases(table, title, context) : null,
        problems,
      };
      // With the function given third, after an argument that isn't one, there is no timeout to read.
      const timeout = spread || kind === 'describe' || given !== fn ? undefined : args.at(2);
      if (timeout && timeout.type !== 'SpreadElement') {
        const option = { node: timeout, resolved: this.file.values.resolve(timeout, context.scopes) };
        const value = readCount(this.file, 'timeout', option, problems);
        if (value !== null) base.details.run = { timeout: value };
      }
      if (kind === 'describe') return { kind: 'describe', ...base, isShuffled: false, passesDown: null };
      return { kind: 'test', ...base, testContext: null, fixtures: [], takesAllFixtures: false, usesBench: false };
    };
    if (flags.has('todo')) {
      if (args.length === 1 && !spread) return declared();
      const refusal = problem(
        'invalid-chain',
        call,
        `${callee}() takes only a title in Jest; with more, the call throws, and Jest fails the file.`,
        callee,
      );
      return refused(call, refusal, context, declared);
    }
    const head = snippet(text(this.file, eachHead(call)));
    if (!spread && args.length < 2 && table && kind === 'test') {
      // jest-each fails on the missing body inside its own try, and registers one test that throws instead.
      const message = `${head}() has no test body, so Jest registers one test titled '${title.text}' that always fails.`;
      problems.push({ ...problem('test-without-body', call, message, head), level: 'warning' });
      const one = declared();
      return { ...one, caseCount: 1, cases: null } as ApiCall;
    }
    if (!spread && args.length < 2) {
      const what = kind === 'test' ? 'test body' : 'function';
      const refusal = problem(
        'test-without-body',
        call,
        `${callee}() has no ${what}, so Jest fails to load the file and runs none of its tests.`,
        callee,
      );
      return refused(call, refusal, context, declared);
    }
    if (body !== undefined && isNotFunction(body)) {
      const refusal = problem(
        'test-without-body',
        call,
        `${callee}() takes its function second, and ${snippet(text(this.file, body))} is not one, so Jest fails the file.`,
        callee,
      );
      return refused(call, refusal, context, () => declared(findFunction(args, 2)));
    }
    if (kind === 'describe' && table && this.isInvalidTable(table, context)) {
      const refusal = problem(
        'describe-throws',
        call,
        `${head}() has an empty table or one that isn't a table, so its describe throws, and Jest fails the file.`,
        head,
      );
      return refused(call, refusal, context, declared);
    }
    if (kind === 'describe' && fn?.async) {
      const refusal = problem(
        'async-describe',
        fn,
        'The describe callback is async, and Jest throws when a describe returns a promise, so it fails the file.',
      );
      return refused(call, refusal, context, declared);
    }
    if (kind === 'describe' && fn) {
      const returned = describeReturns(fn);
      if (returned) {
        const refusal = problem(
          returned === 'promise' ? 'async-describe' : 'describe-throws',
          call,
          returned === 'promise'
            ? 'The describe callback returns a promise, and Jest throws when a describe returns one, so it fails the file.'
            : 'The describe callback returns a value, and Jest throws when a describe returns anything, so it fails the file.',
        );
        return refused(call, refusal, context, declared);
      }
    }
    return declared();
  }

  /** Whether a table makes `describe.each` throw, as jest-each does on an empty array or a value that isn't a table. */
  private isInvalidTable(table: Link, context: CallContext): boolean {
    if (table.template) {
      const headings = templateHeadings(table.template);
      const values = table.template.expressions.length;
      return headings === null || values === 0 || values % headings.length !== 0;
    }
    const cases = (table.args as Argument[]).at(0);
    if (!cases) return true;
    if (cases.type === 'SpreadElement') return false;
    const resolved = this.file.values.resolve(cases, context.scopes);
    return resolved.ok ? !Array.isArray(resolved.value) || resolved.value.length === 0 : false;
  }

  /** Jest's order: `todo` and `skip` set the test's mode, `only` runs it, and `failing` applies when it runs. */
  private states(flags: Set<string>, line: number): StateSetting[] {
    const setting = (state: StateSetting['state']): StateSetting[] => [
      { state, condition: null, reason: null, hasDynamicReason: false, line },
    ];
    if (flags.has('todo')) return setting('todo');
    if (flags.has('skip')) return setting('skip');
    return flags.has('failing') ? setting('expectedToFail') : [];
  }

  /**
   * How many tests a table registers. No table, an empty array, or a tagged template whose first line isn't a line of names or
   * whose values don't fill its rows, makes Jest register one test with the title as written, which fails.
   */
  private caseCount(table: Link, context: CallContext, problems: Problem[]): number | null {
    if (table.template) {
      const headings = templateHeadings(table.template);
      const values = table.template.expressions.length;
      return headings === null || values === 0 || values % headings.length !== 0 ? 1 : values / headings.length;
    }
    const cases = (table.args as Argument[]).at(0);
    if (!cases) return 1;
    const resolved = cases.type === 'SpreadElement' ? null : this.file.values.resolve(cases, context.scopes);
    // A table that isn't an array makes Jest register one test that fails, as an empty one does.
    if (resolved?.ok && !Array.isArray(resolved.value)) return 1;
    const length = this.arrayLength(cases, context);
    if (length === null) {
      const source = snippet(text(this.file, cases));
      problems.push(
        problem('unresolved-cases', cases, 'The cases of .each() could not be counted; caseCount is null.', source),
      );
    }
    return length === 0 ? 1 : length;
  }

  /**
   * The cases of a table whose values the scan can work out, as Jest passes them: a case that is an array is spread
   * into the callback's arguments when every case is one; otherwise each case is passed whole. A tagged template gives
   * one object per row, keyed by the names in its first line.
   */
  private tableCases(table: Link, title: Title, context: CallContext): TableCase[] | null {
    const version = this.file.version;
    if (table.template) {
      const headings = templateHeadings(table.template);
      const resolved = table.template.expressions.map((item) => this.file.values.resolve(item, context.scopes));
      const rows = headings && resolved.length / headings.length;
      if (!headings || !rows || !Number.isInteger(rows) || !resolved.every((item) => item.ok)) return null;
      const values = resolved.map((item) => (item as { value: Value }).value);
      return Array.from({ length: rows }, (_, row) => {
        const item = Object.fromEntries(headings.map((name, column) => [name, values[row * headings.length + column]]));
        return { title: title.isDynamic ? null : jestKeysTitle(title.text, item, row, version, true), args: [item] };
      });
    }
    const first = (table.args as Argument[]).at(0);
    const resolved = first && first.type !== 'SpreadElement' ? this.file.values.resolve(first, context.scopes) : null;
    if (!resolved?.ok || !Array.isArray(resolved.value) || resolved.value.length === 0) return null;
    const cases = resolved.value;
    const arraysOnly = cases.every((item) => Array.isArray(item));
    const byKeys =
      !arraysOnly &&
      !/%[#Odfijops]/.test(title.text.replaceAll('%%', '')) &&
      cases.every((item) => item !== null && typeof item === 'object');
    return cases.map((item, index) => {
      const row = arraysOnly ? (item as Value[]) : [item];
      let caseTitle: string | null = null;
      if (!title.isDynamic) {
        caseTitle = byKeys
          ? jestKeysTitle(title.text, item as Record<string, Value>, index, version, false)
          : jestRowTitle(title.text, row, index, version);
      }
      return { title: caseTitle, args: row };
    });
  }
}

const MULTILINE = /(?:^|\r?\n) *(@[^\n\r]*?) *\r?\n *(?![^\n\r@]*\/\/[^]*)([^\s@][^\n\r@]+?) *\r?\n/g;
const PROPERTY = /(?:^|\r?\n) *@(\S+) *([^\n\r]*)/g;
const LINE_COMMENT = /(^|\s+)\/\/([^\n\r]*)/g;

/**
 * The groups jest-runner-groups gives a file: the values of its `@group` pragmas, as `jest-docblock` 29 and 30 parse
 * the whole text of the file, which reads `@name value` at the start of any line, after a comment's `*`. A pragma's
 * value goes on over the next line when that line has no `@`.
 */
function groups(source: string): string[] {
  if (!source.includes('@group')) return [];
  const newlines = source.match(/\r?\n/g) ?? [];
  const crlf = newlines.filter((item) => item === '\r\n').length;
  const newline = crlf > newlines.length - crlf ? '\r\n' : '\n';
  let block = source
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .replace(/(\r?\n|^) *\* ?/g, '$1');
  let previous = '';
  while (previous !== block) {
    previous = block;
    block = block.replace(MULTILINE, `${newline}$1 $2${newline}`);
  }
  block = block.replace(/^(\r?\n)+/, '').trimEnd();
  return [...block.matchAll(PROPERTY)]
    .filter((match) => match[1] === 'group')
    .map((match) => match[2].replace(LINE_COMMENT, ''))
    .filter((group) => group !== '');
}

/** The names in the first line of a tagged-template table; null when Jest refuses it. */
function templateHeadings(template: TemplateLiteral): string[] | null {
  const match = headingsMatch(template.quasis[0].value.cooked ?? '');
  return match === null ? null : match.replaceAll(/\s/g, '').split('|');
}

/**
 * What jest-each's heading pattern, `/^\n\s*[^\s]+\s*(\|\s*[^\s]+\s*)*\n/`, matches at the start of a table's first
 * string. The pattern backtracks exponentially on a long run of `|` it can't match, which a scanned file could hang the
 * scan with, so its tries are worked out once per position, from the end. `heading[i]` is where the match ends when a
 * heading, `\s*[^\s]+\s*`, starts at `i`, and `rest[i]` where it ends when the heading before ends at `i`: on a `|`,
 * another heading first, else the line break. The pattern tries the whole word first, with its spaces given back one by
 * one, then shorter words, of which only one that ends before a `|` can go on.
 */
export function headingsMatch(text: string): string | null {
  if (!text.startsWith('\n')) return null;
  const isSpace = (index: number) => /\s/.test(text[index]);
  const heading: (number | null)[] = new Array<number | null>(text.length + 1).fill(null);
  const rest: (number | null)[] = new Array<number | null>(text.length + 1).fill(null);
  let nextWord = text.length;
  let whole: number | null = null;
  let shorter: number | null = null;
  for (let index = text.length - 1; index >= 1; index--) {
    if (isSpace(index)) {
      heading[index] = nextWord < text.length ? heading[nextWord] : null;
    } else if (index + 1 === text.length || isSpace(index + 1)) {
      // The last character of a word: the whole word, with the spaces after it, longest first.
      whole = null;
      for (let end = nextWord; end > index && whole === null; end--) whole = rest[end];
      shorter = null;
      heading[index] = whole;
    } else {
      if (shorter === null && text[index + 1] === '|') shorter = heading[index + 2];
      heading[index] = whole ?? shorter;
    }
    if (!isSpace(index)) nextWord = index;
    rest[index] = (text[index] === '|' ? heading[index + 1] : null) ?? (text[index] === '\n' ? index + 1 : null);
  }
  const found = heading[1];
  return found === null ? null : text.slice(0, found);
}

/** The `test.each` of a `test.each(table)(...)` call, as written. */
function eachHead(call: CallExpression): Node {
  const callee = unwrap(call.callee);
  if (callee.type === 'CallExpression') return callee.callee;
  return callee.type === 'TaggedTemplateExpression' ? callee.tag : callee;
}

/** A value that can't be a function, which Jest refuses as a test's or describe's second argument. */
function isNotFunction(node: Argument): boolean {
  const value = unwrap(node as Expression);
  return ['Literal', 'ObjectExpression', 'ArrayExpression', 'TemplateLiteral'].includes(value.type);
}

/** Expressions that are a value whatever they hold. */
const VALUES = new Set([
  'Literal',
  'ObjectExpression',
  'ArrayExpression',
  'TemplateLiteral',
  'ArrowFunctionExpression',
  'FunctionExpression',
  'ClassExpression',
]);

/** Array methods whose result is a new array, which a describe callback returns when written as `() => list.map(...)`. */
const ARRAY_RESULTS = new Set(['map', 'filter', 'flatMap', 'concat', 'slice']);

/**
 * What a describe callback returns that Jest refuses: a promise, or a value the code shows. A call to anything else,
 * such as a helper that registers tests, is taken to return nothing.
 */
function describeReturns(fn: FunctionNode): 'promise' | 'value' | null {
  for (const { expression } of returnValues(fn) ?? []) {
    const value = unwrap(expression);
    if (value.type === 'NewExpression' && value.callee.type === 'Identifier' && value.callee.name === 'Promise') {
      return 'promise';
    }
    if (value.type === 'CallExpression') {
      const callee = unwrap(value.callee);
      if (callee.type !== 'MemberExpression') continue;
      if (callee.object.type === 'Identifier' && callee.object.name === 'Promise') return 'promise';
      if (ARRAY_RESULTS.has(propertyName(callee) ?? '')) return 'value';
      continue;
    }
    if (VALUES.has(value.type)) return 'value';
  }
  return null;
}
