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
import type { HookCounts, MetaValue } from '../types.ts';
import type { Value } from '../values.ts';
import {
  allDeclarators,
  bindAll,
  exportName,
  followImport,
  followModule,
  moduleImports,
  ModuleFunctions,
  requiredModule,
  type Exported,
  type FollowImport,
  type Framework,
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
  returnedFunction,
  returnedTestObject,
  destructuredNames,
  readCount,
  readOptions,
  readStrings,
  isTitleLiteral,
  readReason,
  namedFunction,
  unresolvedOption,
  unresolvedOptions,
  readTitle,
  refused,
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

/** What a test function chosen at run time, as in `isCI ? it.skip : it`, is either way: only the links both have. */
function shared(a: TestFunction | null, b: TestFunction | null): TestFunction | null {
  if (!a || a.kind !== b?.kind) return null;
  const same = (link: Link, index: number) => {
    const other = b.links.at(index);
    return other?.name === link.name && !link.args && !link.template && !other.args && !other.template;
  };
  const differs = a.links.findIndex((link, index) => !same(link, index));
  return { kind: a.kind, links: differs === -1 ? a.links : a.links.slice(0, differs) };
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

/** Where a chain's names are looked up. */
type Lookup = Pick<CallContext, 'scopes' | 'inBody' | 'returnsOf'>;

/** The names through which a test or hook body can skip its test: `context.skip()` or a destructured `skip()`. */
/** The names a test or hook function gives its context, and the context functions it takes out of it. */
interface ContextNames {
  objects: Set<string>;
  skip: Set<string>;
  annotate: Set<string>;
}

/** Keys of the test context that Vitest provides itself, which are not fixtures. */
const CONTEXT_KEYS = new Set([
  'task',
  'signal',
  'expect',
  'skip',
  'annotate',
  'onTestFailed',
  'onTestFinished',
  'bench',
]);

function fixturesOf(fn: FunctionNode | null, index: number | null): string[] {
  return destructuredNames(fn, index).filter((name) => !CONTEXT_KEYS.has(name));
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

/** The names a file binds to Vitest's `test`, `describe`, hooks and namespace. */
class VitestBindings implements TestObjects {
  readonly kinds = new Map<string, Kind>();
  readonly hooks = new Map<string, keyof HookCounts>();
  readonly namespaces = new Set<string>();
  /** Names `bench` is imported as from Vitest 5, which no longer exports it. */
  readonly benches = new Set<string>();
  /** The import specifiers and declarators that bind those names, to tell them from local names that shadow them. */
  readonly declarations = new Set<Node>();
  readonly problems: Problem[] = [];
  /** Names imported from other modules, which may be test objects there. */
  private readonly imported: Map<string, ModuleImport>;
  private readonly follow: FollowImport;
  /** The module's functions and the variables they may build test objects in; see `ModuleFunctions`. */
  private readonly functions: ModuleFunctions;

  constructor(program: Program, version: [number, number] | null, follow: FollowImport) {
    this.imported = moduleImports(program, (source) => source === 'vitest' || MISMATCHED_SOURCES.has(source));
    this.follow = follow;
    this.functions = new ModuleFunctions(program, this.imported, follow);
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
    this.functions.keep(declarators.filter((declarator) => !this.declarations.has(declarator)));
  }

  isTestName(name: string): boolean {
    return this.kinds.has(name) || this.importsTestObject(name) || this.holdsTestObject(name);
  }

  /**
   * `followsCalls` is cleared where a call is not followed to what it returns: while the names are bound, so that only
   * a value asked about is followed, as following reads other modules, and in the scanned file, whose calls the walk
   * follows in their scopes.
   */
  isTestObject(expression: Expression, followsCalls = true): boolean {
    const node = unwrap(expression);
    if (node.type === 'Identifier') {
      const { name } = node;
      return (
        this.kinds.get(name) === 'test' || this.importsTestObject(name) || (followsCalls && this.holdsTestObject(name))
      );
    }
    if (node.type === 'MemberExpression') {
      return KINDS.get(propertyName(node) ?? '') === 'test' && this.isNamespace(node.object);
    }
    // `process.env.CI ? vitestTest : skippedTest` is a test object either way.
    if (node.type === 'ConditionalExpression') {
      return this.isTestObject(node.consequent, followsCalls) || this.isTestObject(node.alternate, followsCalls);
    }
    if (node.type !== 'CallExpression') return false;
    const callee = unwrap(node.callee);
    // `defineBrokerTest()`, a function that returns a test object.
    if (callee.type === 'Identifier') return followsCalls && this.returnsTestObject(callee.name);
    return (
      callee.type === 'MemberExpression' &&
      DERIVATIONS.has(propertyName(callee) ?? '') &&
      this.isTestObject(callee.object, followsCalls)
    );
  }

  returnsTestObject(name: string): boolean {
    return this.functions.returnsTestObject(name, (expression) => this.isTestObject(expression));
  }

  private holdsTestObject(name: string): boolean {
    return this.functions.holdsTestObject(name, (expression) => this.isTestObject(expression));
  }

  reexports(source: string, imported: string, exported: Exported): boolean {
    if (source !== 'vitest') return this.follow(source, imported, exported);
    return exported === 'test object' && KINDS.has(imported);
  }

  /** Whether a name is imported from another module that exports it as a test object, as `base` from './base'. */
  private importsTestObject(name: string): boolean {
    const from = this.imported.get(name);
    return from !== undefined && this.follow(from.source, from.imported);
  }

  isNamespace(expression: Expression): boolean {
    const node = unwrap(expression);
    return node.type === 'Identifier' && this.namespaces.has(node.name);
  }

  private bindImported(imported: string, local: string, version: [number, number] | null): void {
    const kind = KINDS.get(imported);
    if (kind) {
      this.kinds.set(local, kind);
    } else if (isHook(imported)) {
      this.hooks.set(local, imported);
    } else if (imported === 'bench' && atLeast(version, 5, 0)) {
      this.benches.add(local);
    }
  }

  private bind(declarator: VariableDeclarator): boolean {
    const { id, init } = declarator;
    if (!init) return false;
    if (id.type === 'Identifier' && this.isTestObject(init, false)) {
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
      if (key !== null && isHook(key)) this.hooks.set(property.value.name, key);
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
  /** Variables and names of functions read as test objects on trust, each reported once. */
  private readonly assumed = new Set<Node | string>();
  private readonly aliases = new Map<Node, TestFunction | null>();
  /** Describe callbacks and the name of their first parameter, which Vitest calls with its `test`. */
  private readonly suiteParameters = new Map<Node, string>();
  private warnedAboutTags = false;

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    this.file = file;
    this.readModule = readModule;
    // A test object the file builds from an imported one, as in `const it = base.extend({...})`, is followed quietly:
    // a call through the import itself is what reports an import that can't be followed.
    const followed = new Map<string, boolean>();
    this.bindings = new VitestBindings(parsed.program, file.version, (source, imported, exported = 'test object') => {
      const key = `${source}\0${exported}\0${imported}`;
      if (!followed.has(key)) {
        followed.set(key, followModule(source, imported, readModule, this.framework(), exported).exported);
      }
      return followed.get(key) === true;
    });
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

  testFunction(
    expression: Expression,
    scopes: readonly Node[],
    returnsOf: CallContext['returnsOf'],
  ): TestFunction | null {
    return this.aliasOf(expression, { scopes, inBody: false, returnsOf });
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
    const resolved = chain ? this.resolve(chain, call.arguments, context) : null;
    if (!resolved) return null;
    const { kind, links } = resolved;
    if (kind === 'test' && links.length === 1 && isHook(links[0].name)) return this.hook(call, links[0].name);
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

  /**
   * The function a chain calls and the links after it, or null when it isn't one of Vitest's. An import that can't be
   * followed is reported only outside test and hook bodies, where a call can declare tests.
   */
  private resolve(chain: Chain, args: readonly Argument[], lookup: Lookup): TestFunction | null {
    const start = this.start(chain, args, lookup);
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
    lookup: Lookup,
  ): { kind: Kind; index: number; modifiers?: Link[] } | null {
    const { base, links } = chain;
    const { scopes, inBody } = lookup;
    if (base.type === 'CallExpression') {
      const returned = this.returned(base, links, args, lookup);
      return returned && { kind: returned.kind, index: 0, modifiers: returned.links };
    }
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
      this.worthFollowing(base.name, links, args) &&
      this.follow(base.name, !inBody && mayDeclareTests(base.name, links));
    if (!followed && !this.bindings.declarations.has(declaration)) {
      const alias = declaration.type === 'VariableDeclarator' ? this.alias(declaration, lookup) : null;
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
  private alias(declarator: VariableDeclarator, lookup: Lookup): TestFunction | null {
    let alias = this.aliases.get(declarator);
    if (alias === undefined) {
      // Set first, so a variable defined through itself ends the lookup.
      this.aliases.set(declarator, null);
      alias = declarator.init ? this.aliasOf(declarator.init, lookup) : null;
      this.aliases.set(declarator, alias);
    }
    return alias;
  }

  private aliasOf(expression: Expression, lookup: Lookup): TestFunction | null {
    const node = unwrap(expression);
    if (node.type === 'ConditionalExpression') {
      // `isCI ? describe.concurrent : describe`: only the modifiers both branches have apply.
      return shared(this.aliasOf(node.consequent, lookup), this.aliasOf(node.alternate, lookup));
    }
    const chain = readChain(node);
    const resolved = chain ? this.resolve(chain, [], lookup) : null;
    const allowed = (link: Link) =>
      resolved !== null &&
      (MODIFIERS[resolved.kind].has(link.name) || TABLES.has(link.name) || CONDITIONS.has(link.name));
    return resolved?.links.every(allowed) ? resolved : null;
  }

  /**
   * The function a call returns, as `conditionalTest({ min: 22 })` returns `it` or `it.skip`: what all the values the
   * function returns have in common, as for a variable chosen by a condition. When the function can't be found, a call
   * named like a test object is read as one on trust, with a warning; see `returnedTestObject`.
   */
  private returned(
    call: CallExpression,
    links: Link[],
    args: readonly Argument[],
    lookup: Lookup,
  ): TestFunction | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'Identifier') return null;
    const returns = lookup.returnsOf(callee.name, lookup.scopes);
    if (returns) return returnedFunction(returns, shared);
    if (!isTestName(callee.name) || !this.looksLikeTest(links, args)) return null;
    if (!this.assumed.has(callee.name)) {
      this.assumed.add(callee.name);
      this.problems.push(returnedTestObject(this.file, call));
    }
    return { kind: KINDS.get(callee.name) ?? 'test', links: [] };
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

  /**
   * Whether a call through an imported name is worth following to the module: shaped like a test, or any call with a
   * title and a body through a name that reads like a test function, as `it.effect('title', fn)` on a test object that
   * a package extends.
   */
  private worthFollowing(name: string, links: Link[], args: readonly Argument[]): boolean {
    return this.looksLikeTest(links, args) || (isTestName(name) && looksLikeDeclaration(args));
  }

  /** Vitest as followed modules are read, with the rules of the scanned version. */
  private framework(): Framework {
    const version = this.file.version;
    return {
      name: 'Vitest',
      isSource: (source) => source === 'vitest',
      testObjects: (program, follow) => new VitestBindings(program, version, follow),
    };
  }

  /** Follows the import of `name` once, and reports it once when it can't be followed and `report` is set. */
  private follow(name: string, report: boolean): boolean {
    const imported = this.imports.get(name) as ModuleImport;
    let result = this.followed.get(name);
    if (!result) {
      result = followImport(name, imported, this.readModule, this.file, this.framework());
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
        ? isHook(callee.name) && callee.name
        : this.bindings.declarations.has(declaration) && this.bindings.hooks.get(callee.name);
    return hook ? this.hook(call, hook) : null;
  }

  private hook(call: CallExpression, name: keyof HookCounts): ApiCall {
    const fn = findFunction(call.arguments);
    const index = HOOKS.get(name) as number | null;
    return {
      kind: 'hook',
      name,
      fn,
      testContext: index === null ? null : contextNames(fn, index),
      fixtures: fixturesOf(fn, index),
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
    const passed = read.skip ? null : around;
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
      details: read.details,
      fn,
      hashed: fn ?? namedFunction(this.file, context.scopes, body),
      isParameterized: table !== null,
      caseCount: table ? this.caseCount(call, table, context, problems) : null,
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
        testContext: contextNames(fn, index),
        fixtures: fixturesOf(fn, index),
        usesBench: atLeast(this.file.version, 5, 0) && destructuredNames(fn, index).includes('bench'),
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
    for (const flag of ['only', 'todo', 'fails', 'concurrent', 'sequential', 'shuffle']) {
      const option = options.values.get(flag);
      if (option && !option.resolved.ok) {
        const { importedFrom } = option.resolved;
        problems.push(unresolvedOption(this.file, flag, option.node, importedFrom, 'it is not applied'));
      } else if (option?.resolved.ok && flag === 'concurrent') {
        result.concurrent = Boolean(option.resolved.value);
      } else if (option?.resolved.ok) {
        result.flags.set(flag, Boolean(option.resolved.value));
      }
    }
    const skip = options.values.get('skip');
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
      const option = options.values.get(key);
      const value = option ? readCount(this.file, key, option, problems) : null;
      if (value !== null) details.run[key] = value;
    }
    const retry = options.values.get('retry');
    if (retry) this.retry(retry, details, context, problems);
    return result;
  }

  /** `retry` as a number, or since Vitest 4.1 as `{ count, delay, condition }`; the runner ignores an object before. */
  private retry(option: OptionValue, details: Details, context: CallContext, problems: Problem[]): void {
    const node = unwrap(option.node);
    if (node.type !== 'ObjectExpression') {
      const count = readCount(this.file, 'retry', option, problems);
      if (count !== null) details.run.retry = { count, delay: null, condition: null };
      return;
    }
    if (!atLeast(this.file.version, 4, 1)) return;
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
