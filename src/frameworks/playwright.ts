import type { Argument, CallExpression, Expression, Node, Program, VariableDeclarator } from 'oxc-parser';
import { childNodes, isFunctionNode, propertyKey, propertyName, unwrap, type FunctionNode } from '../ast.ts';
import type { Adapter, ApiCall, CallContext, Details, Mode, ModuleReader, Problem, State } from '../model.ts';
import { snippet } from '../source.ts';
import type { Annotation } from '../types.ts';
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
  isTitleLiteral,
  localTestObject,
  looksLikeDeclaration,
  mayDeclareTests,
  mayHoldTestObject,
  namedFunction,
  origin,
  problem,
  readChain,
  readCondition,
  readOptions,
  readReason,
  readStrings,
  readTitle,
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

/** First members that show a name imported from a local file is used as Playwright's `test`. */
const TEST_MEMBERS = new Set(['describe', 'only', 'skip', 'fixme', 'fail', 'step', ...HOOKS]);

/** Calls that need a newer Playwright than the oldest supported one. */
const ADDED_IN = new Map<string, [number, number]>([
  ['fail.only', [1, 49]],
  ['step.skip', [1, 50]],
  ['abort', [1, 60]],
]);

function isPlaywrightSource(source: string): boolean {
  return (
    source === '@playwright/test' || source === 'playwright/test' || source.startsWith('@playwright/experimental-ct-')
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

  constructor(program: Program) {
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
    bindAll(allDeclarators(program), (declarator) => {
      const bound = this.bind(declarator);
      if (bound) this.declarations.add(declarator);
      return bound;
    });
  }

  isTestName(name: string): boolean {
    return this.testNames.has(name);
  }

  isTestObject(expression: Expression): boolean {
    const node = unwrap(expression);
    switch (node.type) {
      case 'Identifier':
        return this.testNames.has(node.name);
      case 'MemberExpression':
        return propertyName(node) === 'test' && this.isModule(node.object);
      case 'ConditionalExpression':
        // `process.env.CI ? ciTest : test` is a test object either way.
        return this.isTestObject(node.consequent) || this.isTestObject(node.alternate);
      case 'CallExpression': {
        const callee = unwrap(node.callee);
        if (callee.type === 'MemberExpression' && propertyName(callee) === 'extend') {
          return this.isTestObject(callee.object);
        }
        return callee.type === 'Identifier'
          ? this.mergeTestsNames.has(callee.name)
          : callee.type === 'MemberExpression' && propertyName(callee) === 'mergeTests' && this.isModule(callee.object);
      }
      default:
        return false;
    }
  }

  reexports(source: string, imported: string): boolean {
    return isPlaywrightSource(source) && (imported === 'test' || imported === 'default');
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
      if (this.isTestObject(init)) {
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

export class PlaywrightAdapter implements Adapter {
  readonly problems: Problem[];
  readonly fileTags: string[] = [];
  readonly usesGlobals = false;
  private readonly file: FileContext;
  private readonly readModule: ModuleReader | null;
  private readonly bindings: PlaywrightBindings;
  private readonly imports: Map<string, ModuleImport>;
  private readonly followed = new Map<string, { exported: boolean; problem: Problem | null }>();
  private readonly reported = new Set<string>();
  private readonly assumed = new Set<Node>();
  private readonly aliases = new Map<Node, string[] | null>();

  constructor(program: Program, file: FileContext, readModule: ModuleReader | null) {
    this.file = file;
    this.readModule = readModule;
    this.bindings = new PlaywrightBindings(program);
    this.problems = [...this.bindings.mismatches];
    this.imports = moduleImports(program, (source) => isPlaywrightSource(source) || MISMATCHED_SOURCES.has(source));
  }

  classify(call: CallExpression, context: CallContext): ApiCall | null {
    const chain = readChain(call.callee);
    const links = chain ? this.testLinks(chain, call.arguments, context.scopes, context.inBody) : null;
    if (!links) return null;
    const names = links.map((link) => link.name);
    const key = names.join('.');
    const addedIn = ADDED_IN.get(key);
    if (addedIn && !atLeast(this.file.version, ...addedIn)) {
      return this.invalid(call, `needs Playwright ${addedIn.join('.')} or newer`);
    }
    if (names[0] === 'info') return this.annotationsPush(call, links, context);
    if (names[0] === 'expect' || names[0] === 'step' || key === 'abort') return { kind: 'other' };
    if (links.some((link) => link.args ?? link.template)) return this.invalid(call, "is not part of Playwright's API");
    if (key === '' || key === 'only' || key === 'skip' || key === 'fixme' || key === 'fail' || key === 'fail.only') {
      return this.testCall(call, key, context);
    }
    const describe = DESCRIBES.get(key);
    if (describe) return this.describeCall(call, describe, context);
    if (key === 'describe.configure') return this.configure(call, context);
    if (HOOKS.has(key)) return { kind: 'hook', fn: findFunction(call.arguments), testContext: null };
    if (OTHER_MEMBERS.has(key)) return { kind: 'other' };
    return this.invalid(call, "is not part of Playwright's API");
  }

  /**
   * The links after the `test` object, or null when the chain doesn't start from Playwright's `test`. An import that
   * can't be followed is reported only outside test and hook bodies, where a call can declare tests.
   */
  private testLinks(chain: Chain, args: readonly Argument[], scopes: readonly Node[], inBody: boolean): Link[] | null {
    const { base, links } = chain;
    let start: number;
    if (base.type === 'Identifier') {
      // A local variable or parameter with the same name, such as `(test) => test.result()`, is not Playwright's.
      const declaration = this.file.values.declarationOf(base.name, scopes);
      const bound = declaration !== null && this.bindings.declarations.has(declaration);
      const local = declaration !== null && this.imports.get(base.name)?.node === declaration;
      const alias =
        declaration?.type === 'VariableDeclarator' && !bound && !local
          ? this.describeAlias(declaration, scopes, inBody)
          : null;
      // The module from `require()` is both the namespace and `test`, so `pw.test(...)` reads as the namespace.
      if (bound && this.bindings.namespaces.has(base.name) && links[0]?.name === 'test' && !links[0].args) {
        start = 1;
      } else if (bound && this.bindings.testNames.has(base.name)) {
        start = 0;
      } else if (alias) {
        return [...alias.map((name) => ({ name, args: null, template: null })), ...links];
      } else if (
        local &&
        this.looksLikeTest(links, args) &&
        this.follow(base.name, !inBody && mayDeclareTests(base.name, links))
      ) {
        start = 0;
      } else if (declaration !== null && !bound && this.assumeLocal(declaration, base.name, links, args)) {
        start = 0;
      } else {
        return null;
      }
    } else if (this.bindings.isModule(base) && links[0]?.name === 'test' && !links[0].args) {
      start = 1;
    } else {
      return null;
    }
    // A test object derived inline, as in `base.extend({ ... }).describe(...)`.
    const derived = links.findLastIndex((link) => link.name === 'extend' && link.args);
    return links.slice(Math.max(start, derived + 1));
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

  /** The members of `test` a variable holds a describe function from, as in `const serialDescribe = test.describe.serial`. */
  private describeAlias(declarator: VariableDeclarator, scopes: readonly Node[], inBody: boolean): string[] | null {
    let members = this.aliases.get(declarator);
    if (members === undefined) {
      // Set first, so a variable defined through itself ends the lookup.
      this.aliases.set(declarator, null);
      members = declarator.init ? this.describeMembers(declarator.init, scopes, inBody) : null;
      this.aliases.set(declarator, members);
    }
    return members;
  }

  private describeMembers(expression: Expression, scopes: readonly Node[], inBody: boolean): string[] | null {
    const node = unwrap(expression);
    if (node.type === 'ConditionalExpression') {
      // `IS_PLATFORM ? test.describe.serial : test.describe`: only the members both branches have apply.
      const consequent = this.describeMembers(node.consequent, scopes, inBody);
      const alternate = this.describeMembers(node.alternate, scopes, inBody);
      if (!consequent || !alternate) return null;
      const shared = consequent.findIndex((name, index) => alternate[index] !== name);
      return shared === -1 ? consequent : consequent.slice(0, shared);
    }
    const chain = readChain(node);
    if (!chain || chain.links.some((link) => link.args ?? link.template)) return null;
    const members = this.testLinks(chain, [], scopes, inBody)?.map((link) => link.name);
    return members && DESCRIBES.has(members.join('.')) ? members : null;
  }

  /** Follows the import of `name` once, and reports it once when it can't be followed and `report` is set. */
  private follow(name: string, report: boolean): boolean {
    const imported = this.imports.get(name) as ModuleImport;
    let result = this.followed.get(name);
    if (!result) {
      result = followImport(name, imported, this.readModule, this.file, {
        name: 'Playwright',
        isSource: isPlaywrightSource,
        testObjects: (program) => new PlaywrightBindings(program),
      });
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

  private invalid(call: CallExpression, reason: string): ApiCall {
    const callee = snippet(text(this.file, call.callee));
    return { kind: 'invalid', problem: problem('invalid-chain', call, `${callee} ${reason}.`, callee) };
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
    return {
      kind: 'test',
      title,
      states: state ? [{ state, condition: null, reason: null, hasDynamicReason: false, line }] : [],
      isOnly: key.endsWith('only'),
      mode: null,
      details: this.details(args.length === 3 ? args[1] : undefined, context, problems, title.text),
      fn,
      hashed: fn ?? namedFunction(this.file, context.scopes, last),
      isParameterized: false,
      caseCount: null,
      testContext: null,
      problems,
    };
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
    if (!mode && locks.length === 0) {
      return problems.length > 0 ? { kind: 'invalid', problem: problems[0] } : { kind: 'other' };
    }
    return { kind: 'configure', mode, locks, problems };
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
    const details: Details = { tags: titleTags(title), annotations: [], locks: [], meta: null };
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
