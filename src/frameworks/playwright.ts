import type { Argument, CallExpression, Expression, Node, Program, VariableDeclarator } from 'oxc-parser';
import { childNodes, isFunctionNode, propertyKey, propertyName, unwrap, type FunctionNode } from '../ast.ts';
import type {
  Adapter,
  ApiCall,
  CallContext,
  Details,
  Mode,
  ModuleReader,
  Problem,
  RunSettings,
  Span,
  State,
} from '../model.ts';
import { snippet } from '../source.ts';
import type { Annotation, HookCounts } from '../types.ts';
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
  boundMembers,
  findFunction,
  hookFunction,
  isTestName,
  isTitleLiteral,
  localTestObject,
  looksLikeDeclaration,
  mayDeclareTests,
  mayHoldTestObject,
  namedFunction,
  origin,
  problem,
  readChain,
  destructuredNames,
  takesWhole,
  readCondition,
  readCount,
  readOptions,
  readReason,
  readStrings,
  readTitle,
  refused,
  returnedFunction,
  returnedTestObject,
  text,
  unresolvedOption,
  unresolvedOptions,
  type Chain,
  type FileContext,
  type Link,
  type OptionValue,
} from './common.ts';

const MISMATCHED_SOURCES = new Set(['vitest', '@jest/globals']);

// Maps rather than object literals, so names such as `constructor` don't match inherited properties.
const DESCRIBES = new Map<string, { only?: boolean; state?: State; mode?: Mode }>([
  ['describe', {}],
  ['describe.only', { only: true }],
  ['describe.skip', { state: 'skip' }],
  ['describe.fixme', { state: 'fixme' }],
  ['describe.serial', { mode: 'serial' }],
  ['describe.serial.only', { mode: 'serial', only: true }],
  ['describe.parallel', { mode: 'parallel' }],
  ['describe.parallel.only', { mode: 'parallel', only: true }],
]);

const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

/** The state each declaring member sets. */
const STATES = new Map<string, State>([
  ['skip', 'skip'],
  ['fixme', 'fixme'],
  ['fail', 'expectedToFail'],
  ['fail.only', 'expectedToFail'],
]);

/** Members of `test` that are known but don't declare or modify tests. */
const OTHER_MEMBERS = new Set(['use', 'slow', 'setTimeout', 'extend']);
/** Members that set how the tests run where they are called. */
const RUN_MEMBERS = new Set(['slow', 'setTimeout']);

/** First members of chains that never declare a test, even when Playwright refuses the rest of the chain. */
const NOT_DECLARING = new Set(['step', 'abort', ...HOOKS, ...OTHER_MEMBERS]);

/** First members that show a name imported from a local file is used as Playwright's `test`. */
const TEST_MEMBERS = new Set(['describe', 'only', 'skip', 'fixme', 'fail', 'step', ...HOOKS]);

/** Where a chain's names are looked up. */
type Lookup = Pick<CallContext, 'scopes' | 'inBody' | 'returnsOf'>;

/** The members of `test` a value chosen at run time holds either way: those both have, if both are the same kind. */
function sharedMembers(a: string[] | null, b: string[] | null): string[] | null {
  if (!a || !b || (a[0] === 'describe') !== (b[0] === 'describe')) return null;
  const differs = a.findIndex((name, index) => b[index] !== name);
  return differs === -1 ? a : a.slice(0, differs);
}

/** Calls that need a newer Playwright than the oldest supported one. */
const ADDED_IN = new Map<string, [number, number]>([
  ['fail.only', [1, 49]],
  ['step.skip', [1, 50]],
  ['abort', [1, 60]],
]);

function isPlaywrightSource(source: string): boolean {
  return (
    source === '@playwright/test' ||
    source === 'playwright/test' ||
    source.startsWith('@playwright/experimental-ct-') ||
    // Files generated from Gherkin features import Playwright's `test` from playwright-bdd, which extends it.
    source === 'playwright-bdd'
  );
}

/** The names a file binds to Playwright's `test`, its namespace and `mergeTests`. */
class PlaywrightBindings implements TestObjects {
  readonly testNames = new Set<string>();
  readonly namespaces = new Set<string>();
  readonly mergeTestsNames = new Set<string>();
  /** The import specifiers and declarators that bind those names, to tell them from local names that shadow them. */
  readonly declarations = new Set<Node>();
  readonly mismatches: Problem[] = [];
  /** Names imported from other modules, which may be test objects there. */
  private readonly imported: Map<string, ModuleImport>;
  private readonly follow: FollowImport;
  /** The module's functions and the variables they may build test objects in; see `ModuleFunctions`. */
  private readonly functions: ModuleFunctions;

  constructor(program: Program, follow: FollowImport) {
    this.imported = moduleImports(program, (source) => isPlaywrightSource(source) || MISMATCHED_SOURCES.has(source));
    this.follow = follow;
    this.functions = new ModuleFunctions(program, this.imported, follow);
    for (const statement of program.body) {
      if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
      const source = statement.source.value;
      if (MISMATCHED_SOURCES.has(source)) {
        this.mismatches.push(
          problem('framework-mismatch', statement, `The file imports '${source}', but the scan is for Playwright.`),
        );
      }
      if (!isPlaywrightSource(source)) continue;
      for (const specifier of statement.specifiers) {
        this.declarations.add(specifier);
        if (specifier.type === 'ImportNamespaceSpecifier') {
          this.namespaces.add(specifier.local.name);
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          this.testNames.add(specifier.local.name);
        } else if (exportName(specifier.imported) === 'test') {
          this.testNames.add(specifier.local.name);
        } else if (exportName(specifier.imported) === 'mergeTests') {
          this.mergeTestsNames.add(specifier.local.name);
        }
      }
    }
    const declarators = allDeclarators(program);
    bindAll(declarators, (declarator) => {
      const bound = this.bind(declarator);
      if (bound) this.declarations.add(declarator);
      return bound;
    });
    this.functions.keep(declarators.filter((declarator) => !this.declarations.has(declarator)));
  }

  isTestName(name: string): boolean {
    return this.testNames.has(name) || this.importsTestObject(name) || this.holdsTestObject(name);
  }

  /**
   * `followsCalls` is cleared where a call is not followed to what it returns: while the names are bound, so that only
   * a value asked about is followed, as following reads other modules, and in the scanned file, whose calls the walk
   * follows in their scopes.
   */
  isTestObject(expression: Expression, followsCalls = true): boolean {
    const node = unwrap(expression);
    switch (node.type) {
      case 'Identifier':
        return (
          this.testNames.has(node.name) ||
          this.importsTestObject(node.name) ||
          (followsCalls && this.holdsTestObject(node.name))
        );
      case 'MemberExpression':
        return propertyName(node) === 'test' && this.isModule(node.object);
      case 'ConditionalExpression':
        // `process.env.CI ? ciTest : test` is a test object either way.
        return this.isTestObject(node.consequent, followsCalls) || this.isTestObject(node.alternate, followsCalls);
      case 'CallExpression': {
        const callee = unwrap(node.callee);
        if (callee.type === 'MemberExpression' && propertyName(callee) === 'extend') {
          return this.isTestObject(callee.object, followsCalls);
        }
        // `mergeTests(a, b)`, or `defineBrokerTest()`, a function that returns a test object.
        return callee.type === 'Identifier'
          ? this.mergeTestsNames.has(callee.name) || (followsCalls && this.returnsTestObject(callee.name))
          : callee.type === 'MemberExpression' && propertyName(callee) === 'mergeTests' && this.isModule(callee.object);
      }
      default:
        return false;
    }
  }

  returnsTestObject(name: string): boolean {
    return this.functions.returnsTestObject(name, (expression) => this.isTestObject(expression));
  }

  private holdsTestObject(name: string): boolean {
    return this.functions.holdsTestObject(name, (expression) => this.isTestObject(expression));
  }

  reexports(source: string, imported: string, exported: Exported): boolean {
    if (!isPlaywrightSource(source)) return this.follow(source, imported, exported);
    return exported === 'test object' && (imported === 'test' || imported === 'default');
  }

  /** Whether a name is imported from another module that exports it as a test object, as `base` from './base'. */
  private importsTestObject(name: string): boolean {
    const from = this.imported.get(name);
    return from !== undefined && this.follow(from.source, from.imported);
  }

  /** Whether an expression is the Playwright module object, from a namespace import or `require`. */
  isModule(expression: Expression): boolean {
    const node = unwrap(expression);
    if (node.type === 'Identifier') return this.namespaces.has(node.name);
    const module = requiredModule(node);
    return module !== null && isPlaywrightSource(module);
  }

  private bind(declarator: VariableDeclarator): boolean {
    const { id, init } = declarator;
    if (!init) return false;
    if (id.type === 'Identifier') {
      if (this.isModule(init)) {
        this.namespaces.add(id.name);
        // `require('@playwright/test')` returns the module, which is Playwright's `test` function itself.
        const node = unwrap(init);
        if (requiredModule(init) !== null || (node.type === 'Identifier' && this.testNames.has(node.name))) {
          this.testNames.add(id.name);
        }
        return true;
      }
      if (this.isTestObject(init, false)) {
        this.testNames.add(id.name);
        return true;
      }
      return false;
    }
    if (id.type !== 'ObjectPattern' || !this.isModule(init)) return false;
    for (const property of id.properties) {
      if (property.type === 'RestElement' || property.value.type !== 'Identifier') continue;
      const key = propertyKey(property);
      if (key === 'test') this.testNames.add(property.value.name);
      if (key === 'mergeTests') this.mergeTestsNames.add(property.value.name);
    }
    return true;
  }
}

const PLAYWRIGHT: Framework = {
  name: 'Playwright',
  isSource: isPlaywrightSource,
  testObjects: (program, follow) => new PlaywrightBindings(program, follow),
};

export class PlaywrightAdapter implements Adapter {
  readonly problems: Problem[];
  readonly fileTags: string[] = [];
  readonly fileTagSpans: Span[] = [];
  readonly usesGlobals = false;
  private readonly file: FileContext;
  private readonly readModule: ModuleReader | null;
  private readonly bindings: PlaywrightBindings;
  private readonly imports: Map<string, ModuleImport>;
  private readonly followed = new Map<string, { exported: boolean; problem: Problem | null }>();
  private readonly reported = new Set<string>();
  /** Variables and names of functions read as test objects on trust, each reported once. */
  private readonly assumed = new Set<Node | string>();
  private readonly aliases = new Map<Node, string[] | null>();

  constructor(program: Program, file: FileContext, readModule: ModuleReader | null) {
    this.file = file;
    this.readModule = readModule;
    // A test object the file builds from an imported one, as in `const test = base.extend({...})`, is followed
    // quietly: a call through the import itself is what reports an import that can't be followed.
    const followed = new Map<string, boolean>();
    this.bindings = new PlaywrightBindings(program, (source, imported, exported = 'test object') => {
      const key = `${source}\0${exported}\0${imported}`;
      if (!followed.has(key)) {
        followed.set(key, followModule(source, imported, readModule, PLAYWRIGHT, exported).exported);
      }
      return followed.get(key) === true;
    });
    this.problems = [...this.bindings.mismatches];
    this.imports = moduleImports(program, (source) => isPlaywrightSource(source) || MISMATCHED_SOURCES.has(source));
  }

  classify(call: CallExpression, context: CallContext): ApiCall | null {
    const chain = readChain(call.callee);
    const links = chain ? this.testLinks(chain, call.arguments, context) : null;
    if (!links) return null;
    const names = links.map((link) => link.name);
    const key = names.join('.');
    const addedIn = ADDED_IN.get(key);
    if (addedIn && !atLeast(this.file.version, ...addedIn)) {
      return this.invalid(call, names, `needs Playwright ${addedIn.join('.')} or newer`, context);
    }
    if (names[0] === 'info') return this.annotationsPush(call, links, context);
    if ((key === 'step' || key === 'step.skip') && context.inTest && call.arguments.length > 0) {
      return this.step(call, key === 'step.skip', context);
    }
    if (names[0] === 'expect' || names[0] === 'step' || key === 'abort') return { kind: 'other' };
    if (links.some((link) => link.args ?? link.template)) {
      return this.invalid(call, names, "is not part of Playwright's API", context);
    }
    if (key === '' || key === 'only' || key === 'skip' || key === 'fixme' || key === 'fail' || key === 'fail.only') {
      return this.testCall(call, key, context);
    }
    const describe = DESCRIBES.get(key);
    if (describe) return this.describeCall(call, describe, context);
    if (key === 'describe.configure') return this.configure(call, context);
    if (HOOKS.has(key)) {
      const fn = hookFunction(this.file, context.scopes, call.arguments);
      return {
        kind: 'hook',
        name: key as keyof HookCounts,
        fn,
        testContext: null,
        fixtures: destructuredNames(fn, 0),
        takesAllFixtures: takesWhole(fn, 0),
      };
    }
    if (RUN_MEMBERS.has(key)) return this.runSetting(call, key, context);
    if (OTHER_MEMBERS.has(key)) return { kind: 'other' };
    return this.invalid(call, names, "is not part of Playwright's API", context);
  }

  /**
   * The links after the `test` object, or null when the chain doesn't start from Playwright's `test`. An import that
   * can't be followed is reported only outside test and hook bodies, where a call can declare tests.
   */
  private testLinks(chain: Chain, args: readonly Argument[], lookup: Lookup): Link[] | null {
    const links = this.linksFromTest(chain, args, lookup);
    if (!links) return null;
    // A test object derived inline, as in `base.extend({ ... }).describe(...)`.
    return links.slice(links.findLastIndex((link) => link.name === 'extend' && link.args) + 1);
  }

  private linksFromTest(chain: Chain, args: readonly Argument[], lookup: Lookup): Link[] | null {
    const { base, links } = chain;
    const { scopes, inBody } = lookup;
    const withMembers = (members: string[]) => [
      ...members.map((name) => ({ name, args: null, template: null })),
      ...links,
    ];
    if (base.type === 'Identifier') {
      // A local variable or parameter with the same name, such as `(test) => test.result()`, is not Playwright's.
      const declaration = this.file.values.declarationOf(base.name, scopes);
      const bound = declaration !== null && this.bindings.declarations.has(declaration);
      const local = declaration !== null && this.imports.get(base.name)?.node === declaration;
      const alias =
        declaration?.type === 'VariableDeclarator' && !bound && !local
          ? this.alias(declaration, base.name, lookup)
          : null;
      // The module from `require()` is both the namespace and `test`, so `pw.test(...)` reads as the namespace.
      if (bound && this.bindings.namespaces.has(base.name) && links[0]?.name === 'test' && !links[0].args) {
        return links.slice(1);
      }
      if (bound && this.bindings.testNames.has(base.name)) return links;
      if (alias) return withMembers(alias);
      if (
        local &&
        this.worthFollowing(base.name, links, args) &&
        this.follow(base.name, !inBody && mayDeclareTests(base.name, links))
      ) {
        return links;
      }
      return declaration !== null && !bound && this.assumeLocal(declaration, base.name, links, args) ? links : null;
    }
    if (this.bindings.isModule(base) && links[0]?.name === 'test' && !links[0].args) return links.slice(1);
    const members = base.type === 'CallExpression' ? this.returned(base, links, args, lookup) : null;
    return members && withMembers(members);
  }

  /**
   * The members of `test` a call returns: none for a test object, as `conditionalTest({ min: 22 })` may return, or
   * those of a describe function. As for a variable chosen by a condition, only the members all its values have apply.
   * When the function can't be found, a call named like a test object is read as one on trust, with a warning.
   */
  private returned(call: CallExpression, links: Link[], args: readonly Argument[], lookup: Lookup): string[] | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'Identifier') return null;
    const returns = lookup.returnsOf(callee.name, lookup.scopes);
    if (returns) return returnedFunction(returns, sharedMembers);
    if (!isTestName(callee.name) || !this.looksLikeTest(links, args)) return null;
    if (!this.assumed.has(callee.name)) {
      this.assumed.add(callee.name);
      this.problems.push(returnedTestObject(this.file, call));
    }
    return [];
  }

  testFunction(expression: Expression, scopes: readonly Node[], returnsOf: CallContext['returnsOf']): string[] | null {
    return this.members(expression, { scopes, inBody: false, returnsOf });
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

  /**
   * The members of `test` a variable holds: those of a describe function, as in `const serialDescribe =
   * test.describe.serial`, none for a test object a function returns, and the member `name` takes when it is
   * destructured, as in `const { beforeEach } = test`. Playwright binds every member to its test object, so a
   * destructured one works as it does on the object; a test object built with a destructured `extend` is not followed.
   */
  private alias(declarator: VariableDeclarator, name: string, lookup: Lookup): string[] | null {
    const destructured = boundMembers(declarator.id, name);
    if (!destructured) return null;
    let members = this.aliases.get(declarator);
    if (members === undefined) {
      // Set first, so a variable defined through itself ends the lookup.
      this.aliases.set(declarator, null);
      members = declarator.init ? this.members(declarator.init, lookup) : null;
      this.aliases.set(declarator, members);
    }
    return members && [...members, ...destructured];
  }

  /** The members of `test` a value holds: none for a test object, or those of a describe function. */
  private members(expression: Expression, lookup: Lookup): string[] | null {
    const node = unwrap(expression);
    if (node.type === 'ConditionalExpression') {
      // `IS_PLATFORM ? test.describe.serial : test.describe`: only the members both branches have apply.
      return sharedMembers(this.members(node.consequent, lookup), this.members(node.alternate, lookup));
    }
    if (this.bindings.isTestObject(node, false)) return [];
    const chain = readChain(node);
    if (!chain || chain.links.some((link) => link.args ?? link.template)) return null;
    const members = this.testLinks(chain, [], lookup)?.map((link) => link.name);
    return members && (members.length === 0 || DESCRIBES.has(members.join('.'))) ? members : null;
  }

  /** Follows the import of `name` once, and reports it once when it can't be followed and `report` is set. */
  private follow(name: string, report: boolean): boolean {
    const imported = this.imports.get(name) as ModuleImport;
    let result = this.followed.get(name);
    if (!result) {
      result = followImport(name, imported, this.readModule, this.file, PLAYWRIGHT);
      this.followed.set(name, result);
      if (result.exported) {
        this.bindings.testNames.add(name);
        this.bindings.declarations.add(imported.node);
      }
    }
    if (report && result.problem && !this.reported.has(name)) {
      this.reported.add(name);
      this.problems.push(result.problem);
    }
    return result.exported;
  }

  /** Whether an argument is, or works out to, a string, as a title is. Spread arguments are handled before. */
  private isTitle(node: Argument, context: CallContext): boolean {
    if (isTitleLiteral(node)) return true;
    const resolved = this.file.values.resolve(node as Expression, context.scopes);
    return resolved.ok && typeof resolved.value === 'string';
  }

  /** A chain Playwright refuses; one that starts like a declaration also declares a plain test or describe. */
  private invalid(call: CallExpression, names: string[], reason: string, context: CallContext): ApiCall {
    const callee = snippet(text(this.file, call.callee));
    const refusal = problem('invalid-chain', call, `${callee} ${reason}.`, callee);
    return refused(call, refusal, context, () => {
      if (NOT_DECLARING.has(names[0])) return { kind: 'other' };
      return names.includes('describe') ? this.describeCall(call, {}, context) : this.testCall(call, '', context);
    });
  }

  private testCall(call: CallExpression, key: string, context: CallContext): ApiCall {
    const args = call.arguments;
    const [first, last] = [args.at(0), args.at(-1)];
    const declarationOnly = key === '' || key === 'only' || key === 'fail.only';
    let declares: boolean;
    if (args.some((arg) => arg.type === 'SpreadElement')) {
      // test(...args) can only be read as a test with an unknown title.
      declares = true;
    } else if (args.length < 2 || args.length > 3 || isFunctionNode(first)) {
      declares = false;
    } else if (declarationOnly) {
      // The body may be a function passed by name.
      declares = true;
    } else {
      // skip, fixme and fail: (title, body) declares a test, (condition, description) changes the state of others.
      declares =
        isFunctionNode(last) || (this.isTitle(args[0], context) && !this.isTitle(args[args.length - 1], context));
    }
    if (!declares && declarationOnly) {
      const callee = snippet(text(this.file, call.callee));
      return {
        kind: 'invalid',
        problem: problem(
          'test-without-body',
          call,
          `${callee}() has no test body, so Playwright fails to load the file and runs no tests at all.`,
        ),
      };
    }
    const state = STATES.get(key) ?? null;
    if (!declares) return this.modifier(call, state as State, context);
    const problems: Problem[] = [];
    const { title, problem: titleProblem } = readTitle(this.file, context.scopes, args[0], {
      stripTags: true,
      functionNames: false,
    });
    if (titleProblem) problems.push(titleProblem);
    const line = this.file.source.line(call.start);
    const fn = isFunctionNode(last) ? last : null;
    const hashed = fn ?? namedFunction(this.file, context.scopes, last);
    return {
      kind: 'test',
      title,
      states: state ? [{ state, condition: null, reason: null, hasDynamicReason: false, line }] : [],
      isOnly: key.endsWith('only'),
      mode: null,
      details: this.details(args.length === 3 ? args[1] : undefined, context, problems, title.text),
      fn,
      hashed,
      isParameterized: false,
      caseCount: null,
      testContext: null,
      fixtures: destructuredNames(hashed, 0),
      takesAllFixtures: takesWhole(hashed, 0),
      usesBench: false,
      problems,
    };
  }

  /** `test.step(title, body)` in a test body; a title that can't be worked out is kept as source text. */
  private step(call: CallExpression, isSkipped: boolean, context: CallContext): ApiCall {
    const { title } = readTitle(this.file, context.scopes, call.arguments[0], {
      stripTags: false,
      functionNames: false,
    });
    return { kind: 'step', title, isSkipped, fn: findFunction(call.arguments, 1) };
  }

  private modifier(call: CallExpression, state: State, context: CallContext): ApiCall {
    const [condition, description] = [call.arguments.at(0), call.arguments.at(1)];
    const problems: Problem[] = [];
    if (isTitleLiteral(condition)) {
      const callee = snippet(text(this.file, call.callee));
      problems.push(
        problem(
          'skip-without-body',
          call,
          `${callee}(${snippet(text(this.file, condition))}) has no test body, so Playwright treats the title as a condition and applies it to every test in the scope.`,
          snippet(text(this.file, call)),
        ),
      );
    }
    const reason = readReason(this.file, context.scopes, description);
    if (reason.problem) problems.push(reason.problem);
    return {
      kind: 'modifier',
      state,
      condition: readCondition(this.file, context.scopes, condition),
      reason: reason.reason,
      hasDynamicReason: reason.isDynamic,
      problems,
    };
  }

  private describeCall(
    call: CallExpression,
    kind: { only?: boolean; state?: State; mode?: Mode },
    context: CallContext,
  ): ApiCall {
    const args = call.arguments;
    if (args.length === 0) return { kind: 'other' };
    const anonymous = isFunctionNode(args[0]);
    const problems: Problem[] = [];
    let title = null;
    if (!anonymous) {
      const read = readTitle(this.file, context.scopes, args[0], { stripTags: true, functionNames: false });
      title = read.title;
      if (read.problem) problems.push(read.problem);
    }
    const fn = anonymous ? (args[0] as FunctionNode) : findFunction(args, 1);
    if (fn?.async && containsAwait(fn)) {
      problems.push(
        problem(
          'async-describe',
          fn,
          'The describe callback awaits, but Playwright does not wait for it; tests declared after the first await end up in the describe around it, or are not collected.',
        ),
      );
    }
    const line = this.file.source.line(call.start);
    return {
      kind: 'describe',
      title,
      states: kind.state ? [{ state: kind.state, condition: null, reason: null, hasDynamicReason: false, line }] : [],
      isOnly: kind.only === true,
      mode: kind.mode ?? null,
      isShuffled: false,
      passesDown: null,
      details: this.details(
        !anonymous && args.length === 3 ? args[1] : undefined,
        context,
        problems,
        title?.text ?? '',
      ),
      fn,
      hashed: fn,
      isParameterized: false,
      caseCount: null,
      problems,
    };
  }

  private configure(call: CallExpression, context: CallContext): ApiCall {
    const options = call.arguments[0] ? readOptions(this.file, context.scopes, call.arguments[0]) : null;
    const option = options?.values.get('mode');
    const mode =
      option?.resolved.ok && ['parallel', 'serial', 'default'].includes(option.resolved.value as string)
        ? (option.resolved.value as Mode)
        : null;
    const problems = mode
      ? []
      : [
          ...(options ? unresolvedOptions(this.file, options, 'the mode is unknown') : []),
          ...(option && !option.resolved.ok
            ? [unresolvedOption(this.file, 'mode', option.node, option.resolved.importedFrom, 'the mode is unknown')]
            : []),
        ];
    const locks: string[] = [];
    const lock = options?.values.get('lock');
    if (lock && atLeast(this.file.version, 1, 64)) {
      const strings = readStrings(this.file, context.scopes, lock);
      locks.push(...strings.values);
      for (const { node: unresolved, importedFrom } of strings.unresolved) {
        problems.push(unresolvedOption(this.file, 'lock', unresolved, importedFrom, 'the lock is missing'));
      }
    }
    const run: RunSettings = {};
    const timeout = options?.values.get('timeout');
    const timeoutValue = timeout ? readCount(this.file, 'timeout', timeout, problems) : null;
    if (timeoutValue !== null) run.timeout = timeoutValue;
    const retries = options?.values.get('retries');
    const count = retries ? readCount(this.file, 'retries', retries, problems) : null;
    if (count !== null) run.retry = { count, delay: null, condition: null };
    if (!mode && locks.length === 0 && Object.keys(run).length === 0) {
      return problems.length > 0 ? { kind: 'invalid', problem: problems[0] } : { kind: 'other' };
    }
    return { kind: 'configure', mode, locks, run, problems };
  }

  /** `test.setTimeout(ms)` or `test.slow(condition?, description?)`, which apply where they are called. */
  private runSetting(call: CallExpression, key: string, context: CallContext): ApiCall {
    const problems: Problem[] = [];
    const settings: RunSettings = {};
    const first = call.arguments.at(0);
    if (key === 'slow') {
      const condition = readCondition(this.file, context.scopes, first);
      if (condition.applies !== 'never')
        settings.slow = { conditions: condition.text === null ? null : [condition.text] };
    } else if (first && first.type !== 'SpreadElement') {
      const option = { node: first, resolved: this.file.values.resolve(first, context.scopes) };
      const timeout = readCount(this.file, 'timeout', option, problems);
      if (timeout !== null) settings.timeout = timeout;
    }
    return { kind: 'run', settings, argument: first ? snippet(text(this.file, first)) : null, problems };
  }

  /** `test.info().annotations.push(...)` inside a test body. */
  private annotationsPush(call: CallExpression, links: Link[], context: CallContext): ApiCall {
    const isPush =
      links.length === 3 && links[0].args !== null && links[1].name === 'annotations' && links[2].name === 'push';
    if (!isPush || !context.inTest) return { kind: 'other' };
    const problems: Problem[] = [];
    const items = call.arguments.flatMap((arg) =>
      arg.type === 'SpreadElement' ? [] : this.annotations(this.option(arg, context.scopes), context.scopes, problems),
    );
    return { kind: 'annotations', items, problems };
  }

  private option(node: Expression, scopes: readonly Node[]): OptionValue {
    return { node, resolved: this.file.values.resolve(node, scopes) };
  }

  /** Reads the `{ tag, annotation, lock }` details of a test or describe. */
  private details(node: Argument | undefined, context: CallContext, problems: Problem[], title: string): Details {
    const details: Details = { tags: titleTags(title), annotations: [], locks: [], meta: null, run: {} };
    if (!node) return details;
    const options = readOptions(this.file, context.scopes, node);
    problems.push(...unresolvedOptions(this.file, options, 'its tags, annotations and locks are missing'));
    const tag = options.values.get('tag');
    if (tag) {
      const tags = readStrings(this.file, context.scopes, tag);
      for (const value of tags.values) {
        if (value.startsWith('@')) {
          details.tags.push(value);
        } else {
          problems.push(
            problem(
              'tag-without-at',
              tag.node,
              `Tag "${value}" does not start with "@", so Playwright fails to load the file and runs no tests at all.`,
              value,
            ),
          );
        }
      }
      for (const { node: unresolved, importedFrom } of tags.unresolved) {
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
    const annotation = options.values.get('annotation');
    if (annotation) details.annotations.push(...this.annotations(annotation, context.scopes, problems));
    const lock = options.values.get('lock');
    if (lock && atLeast(this.file.version, 1, 63)) {
      const locks = readStrings(this.file, context.scopes, lock);
      details.locks.push(...locks.values);
      for (const { node: unresolved, importedFrom } of locks.unresolved) {
        problems.push(unresolvedOption(this.file, 'lock', unresolved, importedFrom, 'the lock is missing'));
      }
    }
    return details;
  }

  private annotations(option: OptionValue, scopes: readonly Node[], problems: Problem[]): Annotation[] {
    const node = unwrap(option.node);
    if (node.type === 'ArrayExpression') {
      return node.elements.flatMap((element) =>
        element === null || element.type === 'SpreadElement'
          ? []
          : this.annotations(this.option(element, scopes), scopes, problems),
      );
    }
    const { resolved } = option;
    const values = resolved.ok ? (Array.isArray(resolved.value) ? resolved.value : [resolved.value]) : [null];
    const lineStart = this.file.source.line(node.start);
    const annotations: Annotation[] = [];
    for (const value of values) {
      const object = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
      const description = object?.description;
      if (typeof object?.type === 'string' && (description === undefined || typeof description === 'string')) {
        annotations.push({ type: object.type, description: description ?? null, lineStart });
      } else {
        const source = snippet(text(this.file, node));
        const from = resolved.ok ? null : resolved.importedFrom;
        problems.push(
          problem(
            'unresolved-annotation',
            node,
            `Annotation ${source}${origin(from)} could not be worked out; it is missing.`,
            source,
          ),
        );
      }
    }
    return annotations;
  }
}

function titleTags(title: string): string[] {
  return title.match(/@\S+/g) ?? [];
}

function containsAwait(fn: FunctionNode): boolean {
  const visit = (node: Node): boolean => {
    if (node.type === 'AwaitExpression' || (node.type === 'ForOfStatement' && node.await)) return true;
    if (node !== fn && isFunctionNode(node)) return false;
    return childNodes(node).some(visit);
  };
  return visit(fn);
}
