import type {
  Argument,
  CallExpression,
  Expression,
  Node,
  Program,
  TemplateLiteral,
  VariableDeclarator,
} from 'oxc-parser';
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
  Adapter,
  ApiCall,
  CallContext,
  Condition,
  Details,
  Mode,
  ModuleReader,
  Problem,
  Span,
  StateSetting,
} from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import { snippet } from '../source.ts';
import type { MetaValue } from '../types.ts';
import type { Value } from '../values.ts';
import {
  allDeclarators,
  bindAll,
  exportName,
  followImport,
  moduleImports,
  requiredModule,
  type ModuleImport,
  type TestObjects,
} from './bindings.ts';
import {
  atLeast,
  findFunction,
  isTestName,
  localTestObject,
  looksLikeDeclaration,
  mayDeclareTests,
  mayHoldTestObject,
  origin,
  problem,
  readChain,
  readCondition,
  readOptions,
  readStrings,
  isTitleLiteral,
  readReason,
  namedFunction,
  unresolvedOption,
  unresolvedOptions,
  readTitle,
  text,
  type Chain,
  type FileContext,
  type Link,
  type OptionValue,
} from './common.ts';

type Kind = 'test' | 'describe';

/** A test or describe function and the links after it, as in `test.skipIf(isCI)`. */
interface TestFunction {
  kind: Kind;
  links: Link[];
}

// Maps rather than object literals, so names such as `constructor` don't match inherited properties.
const KINDS = new Map<string, Kind>([
  ['test', 'test'],
  ['it', 'test'],
  ['describe', 'describe'],
  ['suite', 'describe'],
]);
const MISMATCHED_SOURCES = new Set(['@playwright/test', 'playwright/test', '@jest/globals']);
const MODIFIERS: Record<Kind, Set<string>> = {
  test: new Set(['concurrent', 'sequential', 'only', 'skip', 'todo', 'fails']),
  describe: new Set(['concurrent', 'sequential', 'shuffle', 'skip', 'only', 'todo']),
};
const TABLES = new Set(['each', 'for']);
const CONDITIONS = new Set(['skipIf', 'runIf']);
const DERIVATIONS = new Set(['extend', 'override', 'scoped']);
/** Hooks, with the position of the test context among their callback's parameters. */
const HOOKS = new Map<string, number | null>([
  ['beforeEach', 0],
  ['afterEach', 0],
  ['aroundEach', 1],
  ['beforeAll', null],
  ['afterAll', null],
  ['aroundAll', null],
]);
/** First members that show a name imported from a local file is used as Vitest's `test`. */
const TEST_MEMBERS = new Set([...MODIFIERS.test, ...MODIFIERS.describe, ...TABLES, ...CONDITIONS, ...KINDS.keys()]);
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
interface SkipNames {
  objects: Set<string>;
  functions: Set<string>;
}

/** The names a file binds to Vitest's `test`, `describe`, hooks and namespace. */
class VitestBindings implements TestObjects {
  readonly kinds = new Map<string, Kind>();
  readonly hooks = new Map<string, string>();
  readonly namespaces = new Set<string>();
  /** Names `bench` is imported as from Vitest 5, which no longer exports it. */
  readonly benches = new Set<string>();
  /** The import specifiers and declarators that bind those names, to tell them from local names that shadow them. */
  readonly declarations = new Set<Node>();
  readonly problems: Problem[] = [];

  constructor(program: Program, version: [number, number] | null) {
    for (const statement of program.body) {
      if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
      const source = statement.source.value;
      if (MISMATCHED_SOURCES.has(source)) {
        this.problems.push(
          problem('framework-mismatch', statement, `The file imports '${source}', but the scan is for Vitest.`),
        );
      }
      if (source !== 'vitest') continue;
      for (const specifier of statement.specifiers) {
        this.declarations.add(specifier);
        if (specifier.type === 'ImportNamespaceSpecifier') {
          this.namespaces.add(specifier.local.name);
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          this.problems.push(
            problem(
              'invalid-import',
              specifier,
              "Vitest has no default export; import { test, describe } from 'vitest' instead.",
            ),
          );
        } else {
          this.bindImported(exportName(specifier.imported), specifier.local.name, version);
        }
      }
    }
    const declarators = allDeclarators(program);
    for (const declarator of declarators) {
      if (declarator.init && requiredModule(declarator.init) === 'vitest') {
        this.problems.push(
          problem(
            'invalid-import',
            declarator,
            'Vitest cannot be loaded with require(); tests that use it are missing.',
          ),
        );
      }
    }
    bindAll(declarators, (declarator) => {
      const bound = this.bind(declarator);
      if (bound) this.declarations.add(declarator);
      return bound;
    });
  }

  isTestName(name: string): boolean {
    return this.kinds.has(name);
  }

  isTestObject(expression: Expression): boolean {
    const node = unwrap(expression);
    if (node.type === 'Identifier') return this.kinds.get(node.name) === 'test';
    if (node.type === 'MemberExpression') {
      return KINDS.get(propertyName(node) ?? '') === 'test' && this.isNamespace(node.object);
    }
    // `process.env.CI ? vitestTest : skippedTest` is a test object either way.
    if (node.type === 'ConditionalExpression') {
      return this.isTestObject(node.consequent) || this.isTestObject(node.alternate);
    }
    if (node.type !== 'CallExpression') return false;
    const callee = unwrap(node.callee);
    return (
      callee.type === 'MemberExpression' &&
      DERIVATIONS.has(propertyName(callee) ?? '') &&
      this.isTestObject(callee.object)
    );
  }

  reexports(source: string, imported: string): boolean {
    return source === 'vitest' && KINDS.has(imported);
  }

  isNamespace(expression: Expression): boolean {
    const node = unwrap(expression);
    return node.type === 'Identifier' && this.namespaces.has(node.name);
  }

  private bindImported(imported: string, local: string, version: [number, number] | null): void {
    const kind = KINDS.get(imported);
    if (kind) {
      this.kinds.set(local, kind);
    } else if (HOOKS.has(imported)) {
      this.hooks.set(local, imported);
    } else if (imported === 'bench' && atLeast(version, 5, 0)) {
      this.benches.add(local);
    }
  }

  private bind(declarator: VariableDeclarator): boolean {
    const { id, init } = declarator;
    if (!init) return false;
    if (id.type === 'Identifier' && this.isTestObject(init)) {
      this.kinds.set(id.name, 'test');
      return true;
    }
    if (id.type !== 'ObjectPattern' || !isImportMetaVitest(init)) return false;
    // In-source tests: const { it, describe } = import.meta.vitest
    for (const property of id.properties) {
      if (property.type === 'RestElement' || property.value.type !== 'Identifier') continue;
      const key = propertyKey(property);
      const kind = KINDS.get(key ?? '');
      if (kind) this.kinds.set(property.value.name, kind);
      if (key !== null && HOOKS.has(key)) this.hooks.set(property.value.name, key);
    }
    return true;
  }
}

export class VitestAdapter implements Adapter {
  readonly problems: Problem[];
  readonly fileTags: string[] = [];
  usesGlobals = false;
  private readonly file: FileContext;
  private readonly readModule: ModuleReader | null;
  private readonly bindings: VitestBindings;
  private readonly imports: Map<string, ModuleImport>;
  private readonly followed = new Map<string, { exported: boolean; problem: Problem | null }>();
  private readonly reported = new Set<string>();
  private readonly assumed = new Set<Node>();
  private readonly aliases = new Map<Node, TestFunction | null>();
  /** Describe callbacks and the name of their first parameter, which Vitest calls with its `test`. */
  private readonly suiteParameters = new Map<Node, string>();
  private warnedAboutTags = false;

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    this.file = file;
    this.readModule = readModule;
    this.bindings = new VitestBindings(parsed.program, file.version);
    this.problems = [...this.bindings.problems];
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
    this.imports = moduleImports(parsed.program, (source) => source === 'vitest' || MISMATCHED_SOURCES.has(source));
    if (atLeast(file.version, 4, 1)) {
      // Vitest's own pattern, over the whole text as Vitest reads it, so the same tags come out.
      for (const match of parsed.source.text.matchAll(/(\/\/|\*)\s*@module-tag\s+([\w\-/]+)\b/g)) {
        this.fileTags.push(match[2]);
        this.tagsUsed({ start: match.index, end: match.index + match[0].length });
      }
    }
  }

  classify(call: CallExpression, context: CallContext): ApiCall | null {
    return (
      this.benchCall(call, context) ??
      this.hookCall(call, context) ??
      this.contextSkip(call, context) ??
      this.chainCall(call, context)
    );
  }

  /** A call to `bench` imported from Vitest 5, which is undefined there, so the call throws. */
  private benchCall(call: CallExpression, context: CallContext): ApiCall | null {
    const base = readChain(call.callee)?.base;
    if (base?.type !== 'Identifier' || !this.bindings.benches.has(base.name)) return null;
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

  private chainCall(call: CallExpression, context: CallContext): ApiCall | null {
    const chain = readChain(call.callee);
    const resolved = chain ? this.resolve(chain, call.arguments, context.scopes, context.inBody) : null;
    if (!resolved) return null;
    const { kind, links } = resolved;
    if (kind === 'test' && links.length === 1 && HOOKS.has(links[0].name)) return this.hook(call, links[0].name);
    if (links.length === 1 && DERIVATIONS.has(links[0].name)) return { kind: 'other' };
    const last = links.at(-1);
    if (last && (TABLES.has(last.name) || CONDITIONS.has(last.name)) && !last.args && !last.template) {
      return { kind: 'other' };
    }
    for (const link of links) {
      const called = link.args !== null || link.template !== null;
      const valid = MODIFIERS[kind].has(link.name)
        ? !called
        : TABLES.has(link.name)
          ? called
          : CONDITIONS.has(link.name) && link.args !== null;
      if (!valid) {
        const callee = snippet(text(this.file, call.callee));
        return {
          kind: 'invalid',
          problem: problem('invalid-chain', call, `${callee} is not part of Vitest's API.`, callee),
        };
      }
      if (link.name === 'sequential' && atLeast(this.file.version, 5, 0)) {
        const callee = snippet(text(this.file, call.callee));
        return {
          kind: 'invalid',
          problem: problem('removed-api', call, `sequential was removed in Vitest 5; ${callee}(...) fails.`, callee),
        };
      }
    }
    return this.declaration(call, kind, links, context);
  }

  /**
   * The function a chain calls and the links after it, or null when it isn't one of Vitest's. An import that can't be
   * followed is reported only outside test and hook bodies, where a call can declare tests.
   */
  private resolve(
    chain: Chain,
    args: readonly Argument[],
    scopes: readonly Node[],
    inBody: boolean,
  ): TestFunction | null {
    const start = this.start(chain, args, scopes, inBody);
    if (!start) return null;
    let kind = start.kind;
    let links = [...(start.modifiers ?? []), ...chain.links.slice(start.index)];
    // A test object derived inline, as in `test.extend({ ... }).skip(...)`.
    links = links.slice(links.findLastIndex((link) => DERIVATIONS.has(link.name) && link.args !== null) + 1);
    // Vitest's test object also carries `describe` and `suite`, and they carry `test` and `it`.
    while (links.length > 0 && KINDS.has(links[0].name) && !links[0].args) {
      kind = KINDS.get(links[0].name) as Kind;
      links = links.slice(1);
    }
    return { kind, links };
  }

  private start(
    chain: Chain,
    args: readonly Argument[],
    scopes: readonly Node[],
    inBody: boolean,
  ): { kind: Kind; index: number; modifiers?: Link[] } | null {
    const { base, links } = chain;
    if (base.type !== 'Identifier') return null;
    // A name the file doesn't declare is one of Vitest's globals; a local variable or parameter with the same name,
    // such as `(test) => test.result()`, is not Vitest's.
    const declaration = this.file.values.declarationOf(base.name, scopes);
    if (declaration === null) {
      const global = KINDS.get(base.name);
      if (global) this.usesGlobals = true;
      return global ? { kind: global, index: 0 } : null;
    }
    // A parameter's declaration is its function: `describe('market orders', (test) => { test(...) })`.
    if (this.suiteParameters.get(declaration) === base.name) return { kind: 'test', index: 0 };
    const followed =
      this.imports.get(base.name)?.node === declaration &&
      this.looksLikeTest(links, args) &&
      this.follow(base.name, !inBody && mayDeclareTests(base.name, links));
    if (!followed && !this.bindings.declarations.has(declaration)) {
      const alias = declaration.type === 'VariableDeclarator' ? this.alias(declaration, scopes, inBody) : null;
      if (alias) return { kind: alias.kind, index: 0, modifiers: alias.links };
      return this.assumeLocal(declaration, base.name, links, args)
        ? { kind: KINDS.get(base.name) ?? 'test', index: 0 }
        : null;
    }
    if (this.bindings.namespaces.has(base.name)) {
      const kind = KINDS.get(links.at(0)?.name ?? '');
      return kind ? { kind, index: 1 } : null;
    }
    const kind = this.bindings.kinds.get(base.name);
    return kind ? { kind, index: 0 } : null;
  }

  /** The function and modifiers a variable holds, as in `const skipOnCi = test.skipIf(isCI)`. */
  private alias(declarator: VariableDeclarator, scopes: readonly Node[], inBody: boolean): TestFunction | null {
    let alias = this.aliases.get(declarator);
    if (alias === undefined) {
      // Set first, so a variable defined through itself ends the lookup.
      this.aliases.set(declarator, null);
      alias = declarator.init ? this.aliasOf(declarator.init, scopes, inBody) : null;
      this.aliases.set(declarator, alias);
    }
    return alias;
  }

  private aliasOf(expression: Expression, scopes: readonly Node[], inBody: boolean): TestFunction | null {
    const node = unwrap(expression);
    if (node.type === 'ConditionalExpression') {
      // `isCI ? describe.concurrent : describe`: only the modifiers both branches have apply.
      const consequent = this.aliasOf(node.consequent, scopes, inBody);
      const alternate = this.aliasOf(node.alternate, scopes, inBody);
      if (!consequent || consequent.kind !== alternate?.kind) return null;
      const same = (link: Link, index: number) => {
        const other = alternate.links.at(index);
        return other?.name === link.name && !link.args && !link.template && !other.args && !other.template;
      };
      const shared = consequent.links.findIndex((link, index) => !same(link, index));
      return { kind: consequent.kind, links: shared === -1 ? consequent.links : consequent.links.slice(0, shared) };
    }
    const chain = readChain(node);
    const resolved = chain ? this.resolve(chain, [], scopes, inBody) : null;
    const allowed = (link: Link) =>
      resolved !== null &&
      (MODIFIERS[resolved.kind].has(link.name) || TABLES.has(link.name) || CONDITIONS.has(link.name));
    return resolved?.links.every(allowed) ? resolved : null;
  }

  /** Whether a local variable is read as a test object it could be; see `localTestObject`. */
  private assumeLocal(declaration: Node, name: string, links: Link[], args: readonly Argument[]): boolean {
    if (declaration.type !== 'VariableDeclarator' || !mayHoldTestObject(declaration) || !isTestName(name)) return false;
    if (!this.looksLikeTest(links, args)) return false;
    if (!this.assumed.has(declaration)) {
      this.assumed.add(declaration);
      this.problems.push(localTestObject(this.file, name, declaration));
    }
    return true;
  }

  private looksLikeTest(links: Link[], args: readonly Argument[]): boolean {
    return links.length === 0 ? looksLikeDeclaration(args) : TEST_MEMBERS.has(links[0].name);
  }

  /** Follows the import of `name` once, and reports it once when it can't be followed and `report` is set. */
  private follow(name: string, report: boolean): boolean {
    const imported = this.imports.get(name) as ModuleImport;
    let result = this.followed.get(name);
    if (!result) {
      result = followImport(name, imported, this.readModule, this.file, {
        name: 'Vitest',
        isSource: (source) => source === 'vitest',
        testObjects: (program) => new VitestBindings(program, this.file.version),
      });
      this.followed.set(name, result);
      if (result.exported) {
        this.bindings.kinds.set(name, KINDS.get(imported.imported) ?? 'test');
        this.bindings.declarations.add(imported.node);
      }
    }
    if (report && result.problem && !this.reported.has(name)) {
      this.reported.add(name);
      this.problems.push(result.problem);
    }
    return result.exported;
  }

  /** Hooks called directly, such as `beforeEach(...)` imported from Vitest or used as a global. */
  private hookCall(call: CallExpression, context: CallContext): ApiCall | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'Identifier') return null;
    const declaration = this.file.values.declarationOf(callee.name, context.scopes);
    const hook =
      declaration === null
        ? HOOKS.has(callee.name) && callee.name
        : this.bindings.declarations.has(declaration) && this.bindings.hooks.get(callee.name);
    return hook ? this.hook(call, hook) : null;
  }

  private hook(call: CallExpression, name: string): ApiCall {
    const fn = findFunction(call.arguments);
    const index = HOOKS.get(name) as number | null;
    return { kind: 'hook', fn, testContext: index === null ? null : skipNames(fn, index) };
  }

  private contextSkip(call: CallExpression, context: CallContext): ApiCall | null {
    const names = context.testContext as SkipNames | null;
    if (!names) return null;
    const callee = unwrap(call.callee);
    const isSkip =
      callee.type === 'Identifier'
        ? names.functions.has(callee.name)
        : callee.type === 'MemberExpression' &&
          propertyName(callee) === 'skip' &&
          callee.object.type === 'Identifier' &&
          names.objects.has(callee.object.name);
    if (!isSkip) return null;
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
          return {
            kind: 'invalid',
            problem: problem(
              'removed-api',
              third,
              `${callee}() takes options as its second argument since Vitest 4; with options third the call fails.`,
              snippet(text(this.file, third)),
            ),
          };
        }
        options = third;
      }
    }
    const fn = isFunctionNode(body) ? body : null;
    const read = this.readDeclarationOptions(options, context, problems);
    const flags = new Set([
      ...links.filter((link) => MODIFIERS[kind].has(link.name)).map((link) => link.name),
      ...read.flags,
    ]);
    const conditions = [
      ...links.filter((link) => CONDITIONS.has(link.name)).map((link) => this.linkCondition(link, context)),
      ...read.conditions,
    ];
    const table = links.find((link) => TABLES.has(link.name)) ?? null;
    const isTodo = flags.has('todo') || body === undefined;
    const states = this.states(flags, conditions, isTodo, this.file.source.line(call.start));
    // `{ concurrent: false }` is how Vitest 5 turns parallel off, in place of `sequential`.
    const parallel = read.concurrent ?? flags.has('concurrent');
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
      details: read.details,
      fn,
      hashed: fn ?? namedFunction(this.file, context.scopes, body),
      isParameterized: table !== null,
      caseCount: table ? this.caseCount(call, table, context, problems) : null,
      problems,
    };
    if (kind === 'describe') {
      // A table's cases are passed instead.
      const first = table ? null : fn?.params.at(0);
      if (fn && first?.type === 'Identifier') this.suiteParameters.set(fn, first.name);
      return { kind: 'describe', ...base, isShuffled: flags.has('shuffle') };
    }
    return {
      kind: 'test',
      ...base,
      testContext: skipNames(fn, table?.name === 'for' ? 1 : table ? null : 0),
    };
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
  ): { flags: string[]; concurrent: boolean | null; conditions: Condition[]; details: Details } {
    const details: Details = { tags: [], annotations: [], locks: [], meta: null };
    const result = {
      flags: [] as string[],
      concurrent: null as boolean | null,
      conditions: [] as Condition[],
      details,
    };
    if (!node) return result;
    const options = readOptions(this.file, context.scopes, node);
    problems.push(...unresolvedOptions(this.file, options, 'its flags, tags and meta are missing'));
    for (const flag of ['only', 'todo', 'fails', 'concurrent', 'sequential', 'shuffle']) {
      const option = options.values.get(flag);
      if (option && !option.resolved.ok) {
        const { importedFrom } = option.resolved;
        problems.push(unresolvedOption(this.file, flag, option.node, importedFrom, 'it is not applied'));
      } else if (option?.resolved.ok && flag === 'concurrent') {
        result.concurrent = Boolean(option.resolved.value);
      } else if (option?.resolved.ok && option.resolved.value) {
        result.flags.push(flag);
      }
    }
    const skip = options.values.get('skip');
    if (skip) {
      result.conditions.push(
        skip.resolved.ok
          ? { applies: skip.resolved.value ? 'always' : 'never', text: null }
          : { applies: 'sometimes', text: snippet(text(this.file, skip.node)) },
      );
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
    return result;
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

  private arrayLength(node: Argument | undefined, context: CallContext): number | null {
    if (node === undefined || node.type === 'SpreadElement') return null;
    const resolved = this.file.values.resolve(node, context.scopes);
    if (resolved.ok && Array.isArray(resolved.value)) return resolved.value.length;
    const expression = unwrap(node);
    // The cases may hold values that can't be worked out, such as functions, while the list itself is written out.
    if (
      expression.type === 'ArrayExpression' &&
      expression.elements.every((element) => element?.type !== 'SpreadElement')
    ) {
      return expression.elements.length;
    }
    return null;
  }

  private tagsUsed(node: Span): void {
    if (this.warnedAboutTags) return;
    this.warnedAboutTags = true;
    this.problems.push(
      problem(
        'config-may-change-state',
        node,
        'The file uses Vitest tags, and tags defined in the Vitest config can skip tests or change how they run; the config is not read.',
      ),
    );
  }
}

/** Rows in a tagged-template table such as ``each`a | b ${1} | ${2}` ``: values divided by header columns. */
function templateRows(template: TemplateLiteral): number | null {
  const header = (template.quasis[0].value.cooked ?? template.quasis[0].value.raw).trim().split('\n')[0];
  const columns = header.split('|').filter((column) => column.trim() !== '').length;
  if (columns === 0 || template.expressions.length % columns !== 0) return null;
  return template.expressions.length / columns;
}

function isMetaValue(value: Value): value is MetaValue {
  return value !== undefined;
}

function skipNames(fn: FunctionNode | null, index: number | null): SkipNames | null {
  const parameter = index === null ? undefined : fn?.params[index];
  if (!parameter) return null;
  const names: SkipNames = { objects: new Set(), functions: new Set() };
  if (parameter.type === 'Identifier') names.objects.add(parameter.name);
  if (parameter.type === 'ObjectPattern') {
    for (const property of parameter.properties) {
      if (property.type === 'Property' && propertyKey(property) === 'skip' && property.value.type === 'Identifier') {
        names.functions.add(property.value.name);
      }
    }
  }
  return names;
}
