import type { Argument, CallExpression, Expression, Node, Program, VariableDeclarator } from 'oxc-parser';
import { propertyKey, propertyName, unwrap } from '../ast.ts';
import type { Adapter, ApiCall, CallContext, ModuleReader, Problem, Span } from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import type { HookCounts } from '../types.ts';
import { bindingNames } from '../values.ts';
import {
  allDeclarators,
  bindAll,
  exportName,
  followImport,
  followModule,
  moduleImports,
  ModuleFunctions,
  ownExport,
  requiredModule,
  topLevelDeclarators,
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
  /** Each hook's name in code, and the name it is counted under, as Mocha's `before` is counted as `beforeAll`. */
  hooks: ReadonlyMap<string, keyof HookCounts>;
  /** Members that build a test object from another, such as Vitest's `extend`. */
  derivations: ReadonlySet<string>;
  /** Members that give a test function a mode, as `skip` and `only` do, which a variable can hold it with. */
  modifiers: ReadonlySet<string>;
  /** Whether the test function carries the others, as Vitest's `test.describe` and `describe.test` do. */
  carriesKinds: boolean;
  /** Whether an expression is the framework's module, as `import.meta.vitest` or `require('@jest/globals')` are. */
  isModule: (expression: Expression) => boolean;
  /** Why a default import of the module fails; null when it gives the module. */
  defaultImport: string | null;
  /** Why `require()` of the module fails; null when the module can be required. */
  required: string | null;
  /** Other modules the runner reads as its own, as Bun rewrites `@jest/globals` and `vitest` to `bun:test`. */
  aliases?: ReadonlySet<string>;
  /** What the module is when called, as `node:test`'s default export and `require()` are its `test`. */
  callable?: Start;
  /** Named exports that are the callable module itself, as node:test's `test` and `it`. */
  moduleMembers?: ReadonlySet<string>;
  /** The module's other members, which a chain on the callable module may start with and is then no test. */
  others?: ReadonlySet<string>;
  /** Whether the functions must be imported, as the runner sets no globals; `starts` are then exports only. */
  importOnly?: boolean;
}

/** What a test function chosen at run time, as in `isCI ? it.skip : it`, is either way: only the links both have. */
export function shared(a: TestFunction | null, b: TestFunction | null): TestFunction | null {
  if (!a || a.kind !== b?.kind) return null;
  const same = (link: Link, index: number) => {
    const other = b.links.at(index);
    return other?.name === link.name && !link.args && !link.template && !other.args && !other.template;
  };
  const differs = a.links.findIndex((link, index) => !same(link, index));
  const common = differs === -1 ? a.links : a.links.slice(0, differs);
  const table = a.links.at(-1);
  const otherTable = b.links.at(-1);
  if (
    table &&
    (table.name === 'each' || table.name === 'for') &&
    otherTable?.name === table.name &&
    !table.args &&
    !table.template &&
    !otherTable.args &&
    !otherTable.template &&
    !common.includes(table)
  ) {
    return { kind: a.kind, links: [...common, table] };
  }
  return { kind: a.kind, links: common };
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
  private readonly program: Program;
  /** Names the module declares or imports at its top level, which hide the framework's globals. */
  private readonly declared: Set<string>;

  /** Whether the module is one a scanned file imports from, where no walk reads its globals and chains. */
  private readonly isFollowed: boolean;

  constructor(program: Program, dialect: Dialect, follow: FollowImport, isFollowed = false) {
    this.dialect = dialect;
    this.program = program;
    this.isFollowed = isFollowed;
    this.declared = topLevelNames(program);
    this.imported = moduleImports(program, (source) => isOwnModule(dialect, source) || dialect.mismatched.has(source));
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
      if (!isOwnModule(dialect, source)) continue;
      for (const specifier of statement.specifiers) {
        this.declarations.add(specifier);
        if (specifier.type === 'ImportNamespaceSpecifier') {
          this.namespaces.add(specifier.local.name);
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          if (dialect.defaultImport === null) this.bindModule(specifier.local.name);
          else this.problems.push(problem('invalid-import', specifier, dialect.defaultImport));
        } else {
          this.bindMember(exportName(specifier.imported), specifier.local.name);
        }
      }
    }
    const declarators = allDeclarators(program);
    if (dialect.required !== null) {
      for (const declarator of declarators) {
        if (declarator.init && isOwnModule(dialect, requiredModule(declarator.init))) {
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
        this.boundStart(node)?.kind === 'test' ||
        this.importsTestObject(name) ||
        (followsCalls && this.holdsTestObject(name))
      );
    }
    if (node.type === 'MemberExpression') return this.boundStart(node)?.kind === 'test';
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

  /**
   * What a name or chain stands for: one bound from the framework, a global the module doesn't hide, a member of the
   * module, or one of those with modifiers, as `it.skip`; null otherwise.
   */
  startOf(expression: Expression): Start | null {
    const node = unwrap(expression);
    if (node.type === 'Identifier') {
      const global =
        this.declared.has(node.name) || this.dialect.importOnly ? undefined : this.dialect.starts.get(node.name);
      return this.starts.get(node.name) ?? global ?? null;
    }
    if (node.type !== 'MemberExpression') return null;
    const name = propertyName(node);
    if (name === null) return null;
    if (this.isNamespace(node.object)) return this.dialect.starts.get(name) ?? null;
    const base = this.startOf(node.object);
    return base && this.dialect.modifiers.has(name) ? { kind: base.kind, links: [...base.links, name] } : null;
  }

  /**
   * What a value stands for when the file binds it: in a scanned file, a name bound from the framework or a member of
   * its module, as the walk reads globals and chains itself; in a followed module, also globals and chains.
   */
  private boundStart(expression: Expression): Start | null {
    if (this.isFollowed) return this.startOf(expression);
    const node = unwrap(expression);
    if (node.type === 'Identifier') return this.starts.get(node.name) ?? null;
    if (node.type !== 'MemberExpression' || !this.isNamespace(node.object)) return null;
    const name = propertyName(node) ?? '';
    return this.dialect.starts.get(name) ?? null;
  }

  /** A name the module is bound to: its namespace, and its `test` too when the module can be called. */
  private bindModule(name: string): void {
    this.namespaces.add(name);
    if (this.dialect.callable) this.starts.set(name, this.dialect.callable);
  }

  exportedStart(name: string): Start | null {
    const own = ownExport(this.program, name);
    if (own?.kind === 'default') return this.startOf(own.value);
    const local = own?.kind === 'specifier' ? own.local : name;
    return this.starts.get(local) ?? null;
  }

  private holdsTestObject(name: string): boolean {
    return this.functions.holdsTestObject(name, (expression) => this.isTestObject(expression));
  }

  reexports(source: string, imported: string, exported: Exported): boolean {
    if (!isOwnModule(this.dialect, source)) return this.follow(source, imported, exported);
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
    if (this.dialect.moduleMembers?.has(imported)) {
      this.bindModule(local);
      return;
    }
    const start = this.dialect.starts.get(imported);
    const hook = this.dialect.hooks.get(imported);
    if (start) this.starts.set(local, start);
    else if (hook) this.hooks.set(local, hook);
    else this.members.set(local, imported);
  }

  private bind(declarator: VariableDeclarator): boolean {
    const { id, init } = declarator;
    if (!init) return false;
    if (id.type === 'Identifier' && this.isTestObject(init, false)) {
      // `const later = xit` or `= globals.xit` keeps the skip that `xit` stands for.
      this.starts.set(id.name, this.boundStart(init) ?? TEST);
      return true;
    }
    if (!this.dialect.isModule(init)) return false;
    if (id.type === 'Identifier') {
      this.bindModule(id.name);
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

/** Whether a module is the framework's own, or one it reads as its own. */
function isOwnModule(dialect: Dialect, source: string | null): boolean {
  return source !== null && (source === dialect.source || (dialect.aliases?.has(source) ?? false));
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
  private readonly followed = new Map<string, { exported: boolean; problem: Problem | null; start: unknown }>();
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
      (source) => isOwnModule(dialect, source) || dialect.mismatched.has(source),
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
    if (base.type === 'CallExpression' && this.dialect.isModule(base)) return this.member(chainLinks);
    if (base.type === 'CallExpression') {
      const callee = unwrap(base.callee);
      if (callee.type === 'ConditionalExpression' || callee.type === 'LogicalExpression') {
        const chosen = this.aliasOf(callee, lookup);
        const last = chosen?.links.at(-1);
        if (!chosen || !last || last.args || last.template) return null;
        return {
          kind: chosen.kind,
          index: 0,
          modifiers: [...chosen.links.slice(0, -1), { ...last, args: base.arguments }],
        };
      }
      const returned = this.returned(base, chainLinks, args, lookup);
      return returned && { kind: returned.kind, index: 0, modifiers: returned.links };
    }
    // `(process.env.CI ? it.skip : it)(...)`: a choice written in place, read as one kept in a variable.
    if (base.type === 'ConditionalExpression' || base.type === 'LogicalExpression') {
      const chosen = this.aliasOf(base, lookup);
      return chosen && { kind: chosen.kind, index: 0, modifiers: chosen.links };
    }
    if (base.type !== 'Identifier') return null;
    // A name the file doesn't declare is one of the framework's globals; a local variable or parameter with the same
    // name, such as `(test) => test.result()`, is not the framework's.
    const declaration = this.file.values.declarationOf(base.name, scopes);
    if (declaration === null) {
      const global = this.dialect.importOnly ? undefined : this.dialect.starts.get(base.name);
      if (!global) return null;
      this.usesGlobals = true;
      return { kind: global.kind, index: 0, modifiers: links(global.links) };
    }
    // A parameter's declaration is its function: `describe('market orders', (test) => { test(...) })`.
    if (this.suiteParameters.get(declaration) === base.name) return { kind: 'test', index: 0 };
    const moduleAlias =
      declaration.type === 'VariableDeclarator' ? this.moduleAlias(declaration, base.name, lookup) : null;
    if (moduleAlias) {
      const member = this.member([...links(moduleAlias), ...chainLinks]);
      return member && member.index >= moduleAlias.length
        ? { ...member, index: member.index - moduleAlias.length }
        : null;
    }
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
    if (this.bindings.namespaces.has(base.name)) return this.member(chainLinks);
    const start = this.bindings.starts.get(base.name);
    return start ? { kind: start.kind, index: 0, modifiers: links(start.links) } : null;
  }

  /**
   * What a chain on the framework's module starts with: the member it names, or for a module that can be called, as
   * `node:test`'s, the module itself, as in `test.skip(...)`.
   */
  private member(chainLinks: readonly Link[]): { kind: Kind; index: number; modifiers?: Link[] } | null {
    const start = this.dialect.starts.get(chainLinks.at(0)?.name ?? '');
    if (start) return { kind: start.kind, index: 1, modifiers: links(start.links) };
    const { callable } = this.dialect;
    // The module's other members, as `test.mock.fn()`, are not tests; one it doesn't have is refused as a chain.
    if (!callable || this.dialect.others?.has(chainLinks.at(0)?.name ?? '')) return null;
    return { kind: callable.kind, index: 0, modifiers: links(callable.links) };
  }

  /**
   * The member a name is destructured from a test or describe function as, with that function's kind and the
   * expression it is taken from: `each`, `test` and `test` in `const { each } = test`; null for any other name.
   */
  protected destructuredMember(name: string, lookup: Lookup): { kind: Kind; member: string; from: Expression } | null {
    const declaration = this.file.values.declarationOf(name, lookup.scopes);
    if (declaration?.type !== 'VariableDeclarator') return null;
    const member = boundMembers(declaration.id, name)?.at(-1);
    if (member === undefined) return null;
    const alias = this.alias(declaration, name, lookup);
    // A variable holds a test function only through its value, so there is one.
    return alias && { kind: alias.kind, member, from: declaration.init as Expression };
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

  /** Members taken from a bound module retain its exported kinds, rather than becoming test modifiers. */
  private moduleAlias(declarator: VariableDeclarator, name: string, lookup: Lookup): string[] | null {
    if (!declarator.init) return null;
    const init = unwrap(declarator.init);
    if (!this.bindings.isNamespace(init)) return null;
    if (init.type === 'Identifier') {
      const declaration = this.file.values.declarationOf(init.name, lookup.scopes);
      if (declaration === null || !this.bindings.declarations.has(declaration)) return null;
    }
    let members = boundMembers(declarator.id, name);
    while (members && this.dialect.moduleMembers?.has(members[0])) members = members.slice(1);
    return members;
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
    // A runner without modifiers, as Jasmine, has no members to hold: `it.only` is undefined there, while `fit` keeps
    // the `only` it carries.
    if (chain && chain.links.length > 0 && this.dialect.modifiers.size === 0) return null;
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
      isSource: (source) => isOwnModule(dialect, source),
      testObjects: (program, follow) => new SuiteBindings(program, dialect, follow, true),
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
        const start = (result.start as Start | null | undefined) ?? this.dialect.starts.get(imported.imported) ?? TEST;
        this.bindings.starts.set(name, start);
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
    // A hook on the module, as `test.beforeEach()` on `node:test`'s default export.
    if (callee.type === 'MemberExpression' && this.bindings.isNamespace(callee.object)) {
      const hook = this.dialect.hooks.get(propertyName(callee) ?? '');
      return hook ? this.hook(call, hook, context) : null;
    }
    if (callee.type !== 'Identifier') return null;
    const declaration = this.file.values.declarationOf(callee.name, context.scopes);
    const members =
      declaration?.type === 'VariableDeclarator' ? this.moduleAlias(declaration, callee.name, context) : null;
    if (members?.length === 1) {
      const hook = this.dialect.hooks.get(members[0]);
      if (hook) return this.hook(call, hook, context);
    }
    const hook =
      declaration === null
        ? this.dialect.hooks.get(callee.name)
        : this.bindings.declarations.has(declaration) && this.bindings.hooks.get(callee.name);
    return hook ? this.hook(call, hook, context) : null;
  }

  /** The number of items of a table, also when not all its values are known; see `Values.lengthOf`. */
  protected arrayLength(node: Argument | undefined, context: CallContext): number | null {
    if (node === undefined || node.type === 'SpreadElement') return null;
    return this.file.values.lengthOf(node, context.scopes);
  }
}

/** The names a module declares or imports at its top level, destructured ones too. */
function topLevelNames(program: Program): Set<string> {
  const names = new Set<string>();
  for (const declarator of topLevelDeclarators(program))
    for (const name of bindingNames(declarator.id)) names.add(name);
  for (const statement of program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if ((declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration') && declaration.id) {
      names.add(declaration.id.name);
    }
    if (statement.type === 'ImportDeclaration')
      for (const specifier of statement.specifiers) names.add(specifier.local.name);
  }
  return names;
}
