import type { Argument, CallExpression, Expression, Node, Program, VariableDeclarator } from 'oxc-parser';
import { propertyKey, propertyName, unwrap } from '../ast.ts';
import type { Adapter, ApiCall, CallContext, ModuleReader, Problem, Span } from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import type { HookCounts } from '../types.ts';
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
  boundMembers,
  isTestName,
  localTestObject,
  looksLikeDeclaration,
  mayDeclareTests,
  mayHoldTestObject,
  problem,
  readChain,
  returnedFunction,
  returnedTestObject,
  type Chain,
  type FileContext,
  type Link,
} from './common.ts';

export type Kind = 'test' | 'describe';

/** A test or describe function and the links after it, as in `test.skipIf(isCI)`. */
export interface TestFunction {
  kind: Kind;
  links: Link[];
}

/** A name that starts a chain: the function it is, and the links it stands for, as Jest's `fit` stands for `it.only`. */
export interface Start {
  kind: Kind;
  links: readonly string[];
}

/**
 * How a framework with `describe` and `test` functions, imported or used as globals, names them: Vitest and Jest.
 */
export interface Dialect {
  /** The framework's name in messages. */
  name: string;
  /** The module the functions are imported from. */
  source: string;
  /** Modules of other frameworks, which a file of this one doesn't import. */
  mismatched: ReadonlySet<string>;
  /** The names that start a chain, as exported and as globals; a map, so `constructor` matches nothing inherited. */
  starts: ReadonlyMap<string, Start>;
  hooks: ReadonlySet<string>;
  /** Members that build a test object from another, such as Vitest's `extend`. */
  derivations: ReadonlySet<string>;
  /** Whether the test function carries the others, as Vitest's `test.describe` and `describe.test` do. */
  carriesKinds: boolean;
  /** Whether an expression is the framework's module, as `import.meta.vitest` or `require('@jest/globals')` are. */
  isModule: (expression: Expression) => boolean;
  /** Why a default import of the module fails; null when it gives the module. */
  defaultImport: string | null;
  /** Why `require()` of the module fails; null when the module can be required. */
  required: string | null;
}

/** What a test function chosen at run time, as in `isCI ? it.skip : it`, is either way: only the links both have. */
export function shared(a: TestFunction | null, b: TestFunction | null): TestFunction | null {
  if (!a || a.kind !== b?.kind) return null;
  const same = (link: Link, index: number) => {
    const other = b.links.at(index);
    return other?.name === link.name && !link.args && !link.template && !other.args && !other.template;
  };
  const differs = a.links.findIndex((link, index) => !same(link, index));
  return { kind: a.kind, links: differs === -1 ? a.links : a.links.slice(0, differs) };
}

function links(names: readonly string[]): Link[] {
  return names.map((name) => ({ name, args: null, template: null }));
}

const TEST: Start = { kind: 'test', links: [] };

/** The names a file binds to the framework's test functions, hooks, other exports and module. */
export class SuiteBindings implements TestObjects {
  readonly starts = new Map<string, Start>();
  readonly hooks = new Map<string, keyof HookCounts>();
  readonly namespaces = new Set<string>();
  /** Other names imported from the framework, by their exported name, such as Vitest's `bench` or Jest's `jest`. */
  readonly members = new Map<string, string>();
  /** The import specifiers and declarators that bind those names, to tell them from local names that shadow them. */
  readonly declarations = new Set<Node>();
  readonly problems: Problem[] = [];
  private readonly dialect: Dialect;
  /** Names imported from other modules, which may be test objects there. */
  private readonly imported: Map<string, ModuleImport>;
  private readonly follow: FollowImport;
  /** The module's functions and the variables they may build test objects in; see `ModuleFunctions`. */
  private readonly functions: ModuleFunctions;

  constructor(program: Program, dialect: Dialect, follow: FollowImport) {
    this.dialect = dialect;
    this.imported = moduleImports(program, (source) => source === dialect.source || dialect.mismatched.has(source));
    this.follow = follow;
    this.functions = new ModuleFunctions(program, this.imported, follow);
    for (const statement of program.body) {
      if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
      const source = statement.source.value;
      if (dialect.mismatched.has(source)) {
        this.problems.push(
          problem(
            'framework-mismatch',
            statement,
            `The file imports '${source}', but the scan is for ${dialect.name}.`,
          ),
        );
      }
      if (source !== dialect.source) continue;
      for (const specifier of statement.specifiers) {
        this.declarations.add(specifier);
        if (specifier.type === 'ImportNamespaceSpecifier') {
          this.namespaces.add(specifier.local.name);
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          if (dialect.defaultImport === null) this.namespaces.add(specifier.local.name);
          else this.problems.push(problem('invalid-import', specifier, dialect.defaultImport));
        } else {
          this.bindMember(exportName(specifier.imported), specifier.local.name);
        }
      }
    }
    const declarators = allDeclarators(program);
    if (dialect.required !== null) {
      for (const declarator of declarators) {
        if (declarator.init && requiredModule(declarator.init) === dialect.source) {
          this.problems.push(problem('invalid-import', declarator, dialect.required));
        }
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
    return this.starts.has(name) || this.importsTestObject(name) || this.holdsTestObject(name);
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
        this.starts.get(name)?.kind === 'test' ||
        this.importsTestObject(name) ||
        (followsCalls && this.holdsTestObject(name))
      );
    }
    if (node.type === 'MemberExpression') {
      return this.dialect.starts.get(propertyName(node) ?? '')?.kind === 'test' && this.isNamespace(node.object);
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
      this.dialect.derivations.has(propertyName(callee) ?? '') &&
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
    if (source !== this.dialect.source) return this.follow(source, imported, exported);
    return exported === 'test object' && this.dialect.starts.has(imported);
  }

  /** Whether a name is imported from another module that exports it as a test object, as `base` from './base'. */
  private importsTestObject(name: string): boolean {
    const from = this.imported.get(name);
    return from !== undefined && this.follow(from.source, from.imported);
  }

  /** Whether an expression is the framework's module: a namespace import, or the module itself. */
  isNamespace(expression: Expression): boolean {
    const node = unwrap(expression);
    return (node.type === 'Identifier' && this.namespaces.has(node.name)) || this.dialect.isModule(node);
  }

  private bindMember(imported: string, local: string): void {
    const start = this.dialect.starts.get(imported);
    if (start) this.starts.set(local, start);
    else if (this.dialect.hooks.has(imported)) this.hooks.set(local, imported as keyof HookCounts);
    else this.members.set(local, imported);
  }

  private bind(declarator: VariableDeclarator): boolean {
    const { id, init } = declarator;
    if (!init) return false;
    if (id.type === 'Identifier' && this.isTestObject(init, false)) {
      // `const later = xit` or `= globals.xit` keeps the skip that `xit` stands for.
      const node = unwrap(init);
      let start: Start | undefined;
      if (node.type === 'Identifier') start = this.starts.get(node.name);
      // A member is a test object only when it names one of the starts.
      else if (node.type === 'MemberExpression') start = this.dialect.starts.get(propertyName(node) as string);
      this.starts.set(id.name, start ?? TEST);
      return true;
    }
    if (!this.dialect.isModule(init)) return false;
    if (id.type === 'Identifier') {
      this.namespaces.add(id.name);
      return true;
    }
    if (id.type !== 'ObjectPattern') return false;
    // `const { it, describe } = import.meta.vitest`, or `= require('@jest/globals')`.
    for (const property of id.properties) {
      if (property.type === 'RestElement' || property.value.type !== 'Identifier') continue;
      const key = propertyKey(property);
      if (key !== null) this.bindMember(key, property.value.name);
    }
    return true;
  }
}

/** Where a chain's names are looked up. */
export type Lookup = Pick<CallContext, 'scopes' | 'inBody' | 'returnsOf'>;

/**
 * What Vitest's and Jest's adapters share: how a call's chain is followed to the test or describe function it starts
 * from, through imports, variables, helper functions and globals.
 */
export abstract class SuiteAdapter implements Adapter {
  readonly problems: Problem[];
  readonly fileTags: string[] = [];
  readonly fileTagSpans: Span[] = [];
  usesGlobals = false;
  protected readonly file: FileContext;
  protected readonly bindings: SuiteBindings;
  protected readonly dialect: Dialect;
  /** Describe callbacks and the name of their first parameter, which Vitest calls with its `test`. */
  protected readonly suiteParameters = new Map<Node, string>();
  private readonly readModule: ModuleReader | null;
  private readonly imports: Map<string, ModuleImport>;
  private readonly followed = new Map<string, { exported: boolean; problem: Problem | null }>();
  private readonly reported = new Set<string>();
  /** Variables and names of functions read as test objects on trust, each reported once. */
  private readonly assumed = new Set<Node | string>();
  private readonly aliases = new Map<Node, TestFunction | null>();
  /** First members that show a name imported from a local file is used as the framework's `test`. */
  private readonly testMembers: ReadonlySet<string>;

  constructor(
    parsed: ParsedFile,
    file: FileContext,
    readModule: ModuleReader | null,
    dialect: Dialect,
    testMembers: Iterable<string>,
  ) {
    this.file = file;
    this.readModule = readModule;
    this.dialect = dialect;
    this.testMembers = new Set([...testMembers, ...dialect.starts.keys()]);
    // A test object the file builds from an imported one, as in `const it = base.extend({...})`, is followed quietly:
    // a call through the import itself is what reports an import that can't be followed.
    const followed = new Map<string, boolean>();
    this.bindings = new SuiteBindings(parsed.program, dialect, (source, imported, exported = 'test object') => {
      const key = `${source}\0${exported}\0${imported}`;
      if (!followed.has(key)) {
        followed.set(key, followModule(source, imported, readModule, this.framework(), exported).exported);
      }
      return followed.get(key) === true;
    });
    this.problems = [...this.bindings.problems];
    this.imports = moduleImports(
      parsed.program,
      (source) => source === dialect.source || dialect.mismatched.has(source),
    );
  }

  abstract classify(call: CallExpression, context: CallContext): ApiCall | null;

  /** Whether a variable that holds a test function may hold this link after it, as `const skipOnCi = test.skipIf(isCI)`. */
  protected abstract isAliasLink(kind: Kind, link: Link): boolean;

  protected abstract hook(call: CallExpression, name: keyof HookCounts, context: CallContext): ApiCall;

  testFunction(
    expression: Expression,
    scopes: readonly Node[],
    returnsOf: CallContext['returnsOf'],
  ): TestFunction | null {
    return this.aliasOf(expression, { scopes, inBody: false, returnsOf });
  }

  /**
   * The function a chain calls and the links after it, or null when it isn't the framework's. An import that can't be
   * followed is reported only outside test and hook bodies, where a call can declare tests.
   */
  protected resolve(chain: Chain, args: readonly Argument[], lookup: Lookup): TestFunction | null {
    const start = this.start(chain, args, lookup);
    if (!start) return null;
    let kind = start.kind;
    let links = [...(start.modifiers ?? []), ...chain.links.slice(start.index)];
    // A test object derived inline, as in `test.extend({ ... }).skip(...)`.
    links = links.slice(
      links.findLastIndex((link) => this.dialect.derivations.has(link.name) && link.args !== null) + 1,
    );
    // Vitest's test object also carries `describe` and `suite`, and they carry `test` and `it`.
    while (this.dialect.carriesKinds && links.length > 0 && !links[0].args) {
      const carried = this.dialect.starts.get(links[0].name);
      if (!carried) break;
      kind = carried.kind;
      links = links.slice(1);
    }
    return { kind, links };
  }

  private start(
    chain: Chain,
    args: readonly Argument[],
    lookup: Lookup,
  ): { kind: Kind; index: number; modifiers?: Link[] } | null {
    const { base, links: chainLinks } = chain;
    const { scopes, inBody } = lookup;
    // `require('@jest/globals').test(...)`: the module itself, called in place.
    if (base.type === 'CallExpression' && this.dialect.isModule(base)) {
      const start = this.dialect.starts.get(chainLinks.at(0)?.name ?? '');
      return start ? { kind: start.kind, index: 1, modifiers: links(start.links) } : null;
    }
    if (base.type === 'CallExpression') {
      const returned = this.returned(base, chainLinks, args, lookup);
      return returned && { kind: returned.kind, index: 0, modifiers: returned.links };
    }
    if (base.type !== 'Identifier') return null;
    // A name the file doesn't declare is one of the framework's globals; a local variable or parameter with the same
    // name, such as `(test) => test.result()`, is not the framework's.
    const declaration = this.file.values.declarationOf(base.name, scopes);
    if (declaration === null) {
      const global = this.dialect.starts.get(base.name);
      if (!global) return null;
      this.usesGlobals = true;
      return { kind: global.kind, index: 0, modifiers: links(global.links) };
    }
    // A parameter's declaration is its function: `describe('market orders', (test) => { test(...) })`.
    if (this.suiteParameters.get(declaration) === base.name) return { kind: 'test', index: 0 };
    const followed =
      this.imports.get(base.name)?.node === declaration &&
      this.worthFollowing(base.name, chainLinks, args) &&
      this.follow(base.name, !inBody && mayDeclareTests(base.name, chainLinks));
    if (!followed && !this.bindings.declarations.has(declaration)) {
      const alias = declaration.type === 'VariableDeclarator' ? this.alias(declaration, base.name, lookup) : null;
      if (alias) return { kind: alias.kind, index: 0, modifiers: alias.links };
      return this.assumeLocal(declaration, base.name, chainLinks, args)
        ? { kind: this.dialect.starts.get(base.name)?.kind ?? 'test', index: 0 }
        : null;
    }
    if (this.bindings.namespaces.has(base.name)) {
      const start = this.dialect.starts.get(chainLinks.at(0)?.name ?? '');
      return start ? { kind: start.kind, index: 1, modifiers: links(start.links) } : null;
    }
    const start = this.bindings.starts.get(base.name);
    return start ? { kind: start.kind, index: 0, modifiers: links(start.links) } : null;
  }

  /**
   * The function and modifiers a variable holds, as in `const skipOnCi = test.skipIf(isCI)`, with the member `name`
   * takes when it is destructured, as in `const { beforeEach } = test`. The members Vitest reads through `this`, such as
   * `each` and `skipIf`, return a test function only when called, so their calls are never read through a variable.
   */
  private alias(declarator: VariableDeclarator, name: string, lookup: Lookup): TestFunction | null {
    const destructured = boundMembers(declarator.id, name);
    if (!destructured) return null;
    let alias = this.aliases.get(declarator);
    if (alias === undefined) {
      // Set first, so a variable defined through itself ends the lookup.
      this.aliases.set(declarator, null);
      alias = declarator.init ? this.aliasOf(declarator.init, lookup) : null;
      this.aliases.set(declarator, alias);
    }
    return alias && { kind: alias.kind, links: [...alias.links, ...links(destructured)] };
  }

  private aliasOf(expression: Expression, lookup: Lookup): TestFunction | null {
    const functions = this.choices(expression, lookup)?.functions ?? [];
    if (functions.length === 0) return null;
    // Only the modifiers every choice has apply.
    return functions.slice(1).reduce<TestFunction | null>((common, item) => shared(common, item), functions[0]);
  }

  /**
   * The test functions a value may hold, and whether it may also hold something else, as `process.env.CI` may. A test
   * function is never falsy, so `test.skip || test` and `test.skip ?? test` hold `test.skip`, while
   * `process.env.CI && test.skip || test` may hold either. Both branches of `?:` have to be test functions.
   */
  private choices(expression: Expression, lookup: Lookup): { functions: TestFunction[]; mayBeOther: boolean } | null {
    const node = unwrap(expression);
    if (node.type === 'ConditionalExpression') {
      const [yes, no] = [this.choices(node.consequent, lookup), this.choices(node.alternate, lookup)];
      if (!yes || !no) return null;
      return { functions: [...yes.functions, ...no.functions], mayBeOther: yes.mayBeOther || no.mayBeOther };
    }
    if (node.type === 'LogicalExpression') {
      const [left, right] = [this.choices(node.left, lookup), this.choices(node.right, lookup)];
      const isFunction = left !== null && !left.mayBeOther;
      if (node.operator === '&&') return isFunction ? right : { functions: right?.functions ?? [], mayBeOther: true };
      if (isFunction) return left;
      return {
        functions: [...(left?.functions ?? []), ...(right?.functions ?? [])],
        mayBeOther: right?.mayBeOther ?? true,
      };
    }
    const chain = readChain(node);
    const resolved = chain ? this.resolve(chain, [], lookup) : null;
    const isAlias = resolved?.links.every((link) => this.isAliasLink(resolved.kind, link));
    return resolved && isAlias ? { functions: [resolved], mayBeOther: false } : null;
  }

  /**
   * The function a call returns, as `conditionalTest({ min: 22 })` returns `it` or `it.skip`: what all the values the
   * function returns have in common, as for a variable chosen by a condition. When the function can't be found, a call
   * named like a test object is read as one on trust, with a warning; see `returnedTestObject`.
   */
  private returned(
    call: CallExpression,
    chainLinks: Link[],
    args: readonly Argument[],
    lookup: Lookup,
  ): TestFunction | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'Identifier') return null;
    const returns = lookup.returnsOf(callee.name, lookup.scopes);
    if (returns) return returnedFunction(returns, shared);
    if (!isTestName(callee.name) || !this.looksLikeTest(chainLinks, args)) return null;
    if (!this.assumed.has(callee.name)) {
      this.assumed.add(callee.name);
      this.problems.push(returnedTestObject(this.file, call));
    }
    return { kind: this.dialect.starts.get(callee.name)?.kind ?? 'test', links: [] };
  }

  /** Whether a local variable is read as a test object it could be; see `localTestObject`. */
  private assumeLocal(declaration: Node, name: string, chainLinks: Link[], args: readonly Argument[]): boolean {
    if (declaration.type !== 'VariableDeclarator' || !mayHoldTestObject(declaration) || !isTestName(name)) return false;
    if (!this.looksLikeTest(chainLinks, args)) return false;
    if (!this.assumed.has(declaration)) {
      this.assumed.add(declaration);
      this.problems.push(localTestObject(this.file, name, declaration));
    }
    return true;
  }

  private looksLikeTest(chainLinks: Link[], args: readonly Argument[]): boolean {
    return chainLinks.length === 0 ? looksLikeDeclaration(args) : this.testMembers.has(chainLinks[0].name);
  }

  /**
   * Whether a call through an imported name is worth following to the module: shaped like a test, or any call with a
   * title and a body through a name that reads like a test function, as `it.effect('title', fn)` on a test object that
   * a package extends.
   */
  private worthFollowing(name: string, chainLinks: Link[], args: readonly Argument[]): boolean {
    return this.looksLikeTest(chainLinks, args) || (isTestName(name) && looksLikeDeclaration(args));
  }

  /** The framework as followed modules are read. */
  private framework(): Framework {
    const { dialect } = this;
    return {
      name: dialect.name,
      isSource: (source) => source === dialect.source,
      testObjects: (program, follow) => new SuiteBindings(program, dialect, follow),
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
        this.bindings.starts.set(name, this.dialect.starts.get(imported.imported) ?? TEST);
        this.bindings.declarations.add(imported.node);
      }
    }
    if (report && result.problem && !this.reported.has(name)) {
      this.reported.add(name);
      this.problems.push(result.problem);
    }
    return result.exported;
  }

  /** Hooks called directly, such as `beforeEach(...)` imported from the framework or used as a global. */
  protected hookCall(call: CallExpression, context: CallContext): ApiCall | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'Identifier') return null;
    const declaration = this.file.values.declarationOf(callee.name, context.scopes);
    const hook =
      declaration === null
        ? this.dialect.hooks.has(callee.name) && (callee.name as keyof HookCounts)
        : this.bindings.declarations.has(declaration) && this.bindings.hooks.get(callee.name);
    return hook ? this.hook(call, hook, context) : null;
  }

  /** The number of items of a table written as an array, or held in a value the scan can work out. */
  protected arrayLength(node: Argument | undefined, context: CallContext): number | null {
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
}
