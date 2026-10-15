import type { Expression, ModuleExportName, Node, Program, VariableDeclarator } from 'oxc-parser';
import { childNodes, isFunctionNode, propertyName, returnValues, unwrap, type FunctionNode } from '../ast.ts';
import type { ModuleReader, ModuleSource, Problem } from '../model.ts';
import { parseFile, type ParsedFile } from '../parse.ts';
import { snippet, type SourceText } from '../source.ts';
import { problem, text, type FileContext } from './common.ts';

/** A name imported from a module other than the framework, which may be a custom `test` object in a fixtures file. */
export interface ModuleImport {
  source: string;
  imported: string;
  node: Node;
}

export function exportName(name: ModuleExportName): string {
  return name.type === 'Identifier' ? name.name : name.value;
}

/** What a module is followed for: a test object, or a function that returns one, as in `defineBrokerTest()`. */
export type Exported = 'test object' | 'function';

/** Names a module's test objects are known by, used to check what a fixtures file exports. */
export interface TestObjects {
  isTestObject(expression: Expression): boolean;
  isTestName(name: string): boolean;
  /** Whether a function the module declares or imports under `name` returns a test object. */
  returnsTestObject(name: string): boolean;
  /** Whether re-exporting `imported` from `source` exports a test object, or a function that returns one. */
  reexports(source: string, imported: string, exported: Exported): boolean;
}

/**
 * The functions a module declares at its top level, by name, to tell whether one returns a test object: every value it
 * returns is one, as `return base.extend({...})` is. An imported function is followed to its module. The function a
 * module exports as its default, named or not, is also known as `default`.
 */
export class ModuleFunctions {
  private readonly functions: Map<string, FunctionNode>;
  /** The functions being read, to end a function that returns what it returns itself. */
  private readonly reading = new Set<FunctionNode>();
  /** Whether each function returns a test object, read once however many calls and functions lead to it. */
  private readonly read = new Map<FunctionNode, boolean>();
  /** The values of variables the bindings left unbound, by name, which a call may make test objects. */
  private readonly values = new Map<string, Expression[]>();
  /** Whether each of those holds a test object; null while that is being worked out, which ends a loop. */
  private readonly built = new Map<string, boolean | null>();
  private readonly imported: Map<string, ModuleImport>;
  private readonly follow: FollowImport;

  constructor(program: Program, imported: Map<string, ModuleImport>, follow: FollowImport) {
    this.functions = topLevelFunctions(program);
    this.imported = imported;
    this.follow = follow;
  }

  /** Keeps the variables the bindings didn't bind without following calls, to be worked out when asked. */
  keep(declarators: Iterable<VariableDeclarator>): void {
    for (const { id, init } of declarators) {
      if (id.type === 'Identifier' && init) this.values.set(id.name, [...(this.values.get(id.name) ?? []), init]);
    }
  }

  /**
   * Whether a variable holds a test object built by a call, as `const test = defineBrokerTest()`. It is worked out
   * only when asked, as following the call reads other modules.
   */
  holdsTestObject(name: string, isTestObject: (expression: Expression) => boolean): boolean {
    const values = this.values.get(name);
    if (!values) return false;
    if (!this.built.has(name)) {
      this.built.set(name, null);
      this.built.set(name, values.some(isTestObject));
    }
    return this.built.get(name) === true;
  }

  returnsTestObject(name: string, isTestObject: (expression: Expression) => boolean): boolean {
    const fn = this.functions.get(name);
    if (!fn) {
      const from = this.imported.get(name);
      return from !== undefined && this.follow(from.source, from.imported, 'function');
    }
    if (this.reading.has(fn)) return false;
    if (!this.read.has(fn)) {
      this.reading.add(fn);
      this.read.set(fn, returnValues(fn)?.every(({ expression }) => isTestObject(expression)) ?? false);
      this.reading.delete(fn);
    }
    return this.read.get(fn) === true;
  }
}

/** The functions a module declares at its top level, by name; the one it exports as its default is also `default`. */
function topLevelFunctions(program: Program): Map<string, FunctionNode> {
  const functions = new Map<string, FunctionNode>();
  for (const statement of program.body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const value = statement.declaration as Node;
      if (value.type === 'FunctionDeclaration' || isFunctionNode(value)) functions.set('default', value);
    }
    const declaration =
      statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
        ? statement.declaration
        : statement;
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      functions.set(declaration.id.name, declaration);
    } else if (declaration?.type === 'VariableDeclaration') {
      for (const { id, init } of declaration.declarations) {
        const value = init ? unwrap(init) : null;
        if (id.type === 'Identifier' && isFunctionNode(value)) functions.set(id.name, value);
      }
    }
  }
  return functions;
}

export function topLevelDeclarators(program: Program): VariableDeclarator[] {
  const declarators: VariableDeclarator[] = [];
  for (const statement of program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type === 'VariableDeclaration') declarators.push(...declaration.declarations);
  }
  return declarators;
}

/** All variable declarators in the file, at any depth, such as `const { it } = import.meta.vitest` inside an `if`. */
export function allDeclarators(program: Program): VariableDeclarator[] {
  const declarators: VariableDeclarator[] = [];
  const visit = (node: Node) => {
    if (node.type === 'VariableDeclarator') declarators.push(node);
    for (const child of childNodes(node)) visit(child);
  };
  visit(program);
  return declarators;
}

/** The names a file imports from modules other than the framework, which `isFramework` tells apart. */
export function moduleImports(program: Program, isFramework: (source: string) => boolean): Map<string, ModuleImport> {
  const imports = new Map<string, ModuleImport>();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
    if (isFramework(statement.source.value)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') continue;
      const imported = specifier.type === 'ImportSpecifier' ? exportName(specifier.imported) : 'default';
      imports.set(specifier.local.name, { source: statement.source.value, imported, node: specifier });
    }
  }
  return imports;
}

/** The module of `require('module')`, or null for any other expression. */
export function requiredModule(expression: Expression): string | null {
  const node = unwrap(expression);
  if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'require')
    return null;
  const argument = node.arguments.at(0);
  return argument?.type === 'Literal' && typeof argument.value === 'string' ? argument.value : null;
}

/** The module of `module.exports = require('module')`, which exports what that module does; null otherwise. */
function commonJsReexport(statement: Node): string | null {
  if (statement.type !== 'ExpressionStatement') return null;
  const expression = unwrap(statement.expression);
  if (expression.type !== 'AssignmentExpression') return null;
  const target = expression.left;
  const isModuleExports =
    target.type === 'MemberExpression' &&
    target.object.type === 'Identifier' &&
    target.object.name === 'module' &&
    propertyName(target) === 'exports';
  return isModuleExports ? requiredModule(expression.right) : null;
}

/** Applies `bind` to each declarator until no more names are bound, so declaration order doesn't matter. */
export function bindAll(declarators: VariableDeclarator[], bind: (declarator: VariableDeclarator) => boolean): void {
  const pending = new Set(declarators);
  let changed = true;
  while (changed) {
    changed = false;
    for (const declarator of pending) {
      if (bind(declarator)) {
        pending.delete(declarator);
        changed = true;
      }
    }
  }
}

/** Whether a module exports `name` as a test object, or as a function that returns one. */
export function exportsTestObject(
  program: Program,
  name: string,
  objects: TestObjects,
  exported: Exported = 'test object',
): boolean {
  const own = ownExport(program, name);
  const local = (localName: string) =>
    exported === 'function' ? objects.returnsTestObject(localName) : objects.isTestName(localName);
  switch (own?.kind) {
    case 'default': {
      if (exported === 'test object') return objects.isTestObject(own.value);
      // `export default defineBrokerTest`, or a function written there, which the module's functions know as `default`.
      const value = unwrap(own.value);
      return objects.returnsTestObject(value.type === 'Identifier' ? value.name : 'default');
    }
    case 'variable':
      return local(name);
    case 'function':
      return exported === 'function' && objects.returnsTestObject(name);
    case 'specifier':
      return own.source === null ? local(own.local) : objects.reexports(own.source, own.local, exported);
  }
  return program.body.some((statement) => {
    const source = starReexport(statement);
    return source !== null && objects.reexports(source, name, exported);
  });
}

/** How a module exports `name` itself: declared, or exported by name from a local or another module. */
type OwnExport =
  | { kind: 'default'; value: Expression }
  | { kind: 'variable' | 'function' }
  | { kind: 'specifier'; local: string; source: string | null };

/**
 * The module's own export of `name`; null when it has none and only `export *` may pass the name on. An own export
 * wins over those, as in JavaScript.
 */
function ownExport(program: Program, name: string): OwnExport | null {
  for (const statement of program.body) {
    if (statement.type === 'ExportDefaultDeclaration' && name === 'default') {
      return { kind: 'default', value: statement.declaration as Expression };
    }
    if (statement.type !== 'ExportNamedDeclaration') continue;
    const { declaration } = statement;
    if (declaration?.type === 'VariableDeclaration') {
      const declared = declaration.declarations.some((item) => item.id.type === 'Identifier' && item.id.name === name);
      if (declared) return { kind: 'variable' };
    }
    const named = declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration';
    if (named && declaration.id?.name === name) return { kind: 'function' };
    for (const specifier of statement.specifiers) {
      if (exportName(specifier.exported) !== name) continue;
      return { kind: 'specifier', local: exportName(specifier.local), source: statement.source?.value ?? null };
    }
  }
  return null;
}

/** The module `export * from 'module'` or `module.exports = require('module')` passes every name on from; or null. */
function starReexport(statement: Node): string | null {
  if (statement.type === 'ExportAllDeclaration') return statement.exported ? null : statement.source.value;
  return commonJsReexport(statement);
}

/**
 * Where a module gets a name it exports from another module, and how: by re-exporting it or by building on it. A test
 * object built by calling an imported function, as in `defineBrokerTest()`, comes from that function.
 */
interface ImportOrigin {
  source: string;
  imported: string;
  how: 're-exports' | 'builds';
  exported: Exported;
}

/**
 * The module and name a module's export comes from when it re-exports it, as in `export { test } from './base'`, or
 * builds it from something imported, directly or through its own variables, as in `const test = base.extend({...})`.
 */
function importOrigin(
  program: Program,
  name: string,
  isFramework: (source: string) => boolean,
  exported: Exported,
): ImportOrigin | null {
  const imported = moduleImports(program, isFramework);
  const own = ownExport(program, name);
  if (own === null) {
    for (const statement of program.body) {
      const source = starReexport(statement);
      if (source !== null && !isFramework(source)) return { source, imported: name, how: 're-exports', exported };
    }
  } else if (own.kind === 'specifier') {
    // `export { test } from './fixtures'`, or `import { test } from './fixtures'` and then `export { test }`.
    const from = own.source === null ? imported.get(own.local) : { source: own.source, imported: own.local };
    if (from && !isFramework(from.source)) {
      return { source: from.source, imported: from.imported, how: 're-exports', exported };
    }
  }
  if (exported === 'function') return null;
  const values = new Map<string, Node>();
  for (const declarator of topLevelDeclarators(program)) {
    if (declarator.id.type === 'Identifier' && declarator.init) values.set(declarator.id.name, declarator.init);
  }
  const functions = topLevelFunctions(program);
  const seen = new Set<string>();
  type Origin = Omit<ImportOrigin, 'how'>;
  const from = (local: string, kind: Exported): Origin | null => {
    const found = imported.get(local);
    return found ? { source: found.source, imported: found.imported, exported: kind } : null;
  };
  // The import a local name is, or is built from: the object `extend` is called on, an imported function that builds
  // it, what a function the module writes returns, the test objects a call such as `mergeTests(a, b)` combines,
  // either side of `?:`, or another local name. Values only passed along, such as a fixtures object in
  // `base.extend(fixtures)`, are not what the test object is built on.
  const builtFrom = (local: string): Origin | null => {
    const value = values.get(local);
    if (imported.has(local) || !value || seen.has(local)) return from(local, 'test object');
    seen.add(local);
    return builtOn(value);
  };
  const builtOn = (node: Node): Origin | null => {
    const expression = unwrap(node as Expression);
    switch (expression.type) {
      case 'Identifier':
        return builtFrom(expression.name);
      case 'MemberExpression':
        return builtOn(expression.object);
      case 'ConditionalExpression':
        return builtOn(expression.consequent) ?? builtOn(expression.alternate);
      case 'CallExpression': {
        const callee = unwrap(expression.callee);
        if (callee.type === 'MemberExpression' && propertyName(callee) === 'extend') return builtOn(callee.object);
        if (callee.type === 'Identifier' && imported.has(callee.name)) return from(callee.name, 'function');
        const fn = callee.type === 'Identifier' && !seen.has(callee.name) ? functions.get(callee.name) : undefined;
        if (fn && callee.type === 'Identifier') {
          seen.add(callee.name);
          for (const { expression: value } of returnValues(fn) ?? []) {
            const found = builtOn(value);
            if (found) return found;
          }
        }
        for (const argument of expression.arguments) {
          const found = argument.type === 'SpreadElement' ? null : builtOn(argument);
          if (found) return found;
        }
        return null;
      }
      default:
        return null;
    }
  };
  // `export { test as browserTest }` exports a variable under another name.
  const locals = program.body.flatMap((statement) =>
    statement.type === 'ExportNamedDeclaration' && !statement.source
      ? statement.specifiers.filter((item) => exportName(item.exported) === name).map((item) => exportName(item.local))
      : [],
  );
  for (const local of [name, ...locals]) {
    const found = values.has(local) ? builtFrom(local) : null;
    if (found) return { ...found, how: 'builds' };
  }
  // `export default defineBrokerTest()`, built where it is exported.
  const found = own?.kind === 'default' ? builtOn(own.value) : null;
  return found && { ...found, how: 'builds' };
}

/** Whether a module imports, re-exports or requires any of the given sources. */
export function importsFrom(program: Program, matches: (source: string) => boolean): boolean {
  const requires = (node: Node): boolean => {
    const source = node.type === 'CallExpression' ? requiredModule(node) : null;
    return (source !== null && matches(source)) || childNodes(node).some(requires);
  };
  return program.body.some(
    (statement) =>
      ((statement.type === 'ImportDeclaration' || statement.type === 'ExportAllDeclaration') &&
        matches(statement.source.value)) ||
      (statement.type === 'ExportNamedDeclaration' && statement.source !== null && matches(statement.source.value)) ||
      requires(statement),
  );
}

/** Whether a name a module imports from another module is a test object there, which follows that module in turn. */
export type FollowImport = (source: string, imported: string, exported?: Exported) => boolean;

/** How a framework recognizes the modules and test objects of a followed file. */
export interface Framework {
  name: string;
  isSource: (source: string) => boolean;
  /** The test objects of a followed module, which uses `follow` for the names it imports from other modules. */
  testObjects: (program: Program, follow: FollowImport) => TestObjects;
}

/** Parsed modules, kept while their source is, so that a fixtures file many tests import is parsed once. */
const parsedModules = new WeakMap<ModuleSource, ParsedFile>();

/** Shared with the walk of imported helpers, so that a module both read and walked is parsed once. */
export function parseModule(module: ModuleSource): ParsedFile {
  let parsed = parsedModules.get(module);
  if (!parsed) {
    parsed = parseFile(module.relativeFilePath, module.code);
    parsedModules.set(module, parsed);
  }
  return parsed;
}

/** How many modules deep an import is followed, far more than real fixture chains need. */
const MAX_DEPTH = 16;

/**
 * Whether `name` from `source` is a test object, following the module through the modules it re-exports from or builds
 * on, as deep as it takes. When it isn't, the reason says where the chain ends; it is null for a module that has
 * nothing to do with the framework, as when a call only looked like a test. Each module is followed once for a name,
 * however many imports lead to it, as fixtures files that build on several others share their bases.
 */
export function followModule(
  source: string,
  name: string,
  readModule: ModuleReader | null,
  framework: Framework,
  exported: Exported = 'test object',
  path: readonly string[] = [],
  followed = new Map<string, Followed>(),
): Followed {
  // Without a reader, as in scanSource, nothing can be read.
  const module = readModule ? readModule(source) : { reason: 'could not be read' };
  if ('reason' in module) return { exported: false, reason: module.reason };
  // A module may be followed again for another name, as a fixtures file that a function it imports builds on.
  const key = `${module.relativeFilePath}\0${exported}\0${name}`;
  if (path.includes(key)) return { exported: false, reason: 'imports it back, in a cycle' };
  if (path.length >= MAX_DEPTH) return { exported: false, reason: `is more than ${MAX_DEPTH} modules deep` };
  let result = followed.get(key);
  if (!result) {
    result = followExports(module, name, framework, exported, [...path, key], followed);
    followed.set(key, result);
  }
  return result;
}

interface Followed {
  exported: boolean;
  reason: string | null;
}

/**
 * Whether a module exports `name` as a test object; `within` is the chain of modules and names followed to it, itself
 * last.
 */
function followExports(
  module: ModuleSource,
  name: string,
  framework: Framework,
  exported: Exported,
  within: readonly string[],
  followed: Map<string, Followed>,
): Followed {
  const { program, error, source } = parseModule(module);
  if (error) return { exported: false, reason: 'could not be parsed' };
  const followFrom = (from: string, imported: string, kind: Exported) =>
    followModule(from, imported, module.readModule, framework, kind, within, followed);
  const objects = framework.testObjects(
    program,
    (from, imported, kind = 'test object') => followFrom(from, imported, kind).exported,
  );
  if (exportsTestObject(program, name, objects, exported)) return { exported: true, reason: null };
  const unrecognized = (kind: Exported) =>
    `does not export ${kind === 'function' ? 'a function that returns a test object' : `a ${framework.name} test object`} that could be recognized`;
  const origin = importOrigin(program, name, framework.isSource, exported);
  if (origin) {
    const end = followFrom(origin.source, origin.imported, origin.exported).reason ?? unrecognized(origin.exported);
    return { exported: false, reason: `${origin.how} it from '${origin.source}', which ${end}` };
  }
  if (importsFrom(program, framework.isSource)) return { exported: false, reason: unrecognized(exported) };
  // A module that doesn't import the framework may still build the test object with a function, as in
  // `export const test = defineBrokerTest()`; one the scan can't follow is worth an error, not silence.
  const call = exported === 'test object' ? creatingCall(program, name, source) : null;
  return { exported: false, reason: call ? `builds it with ${call}, which is not followed` : null };
}

/**
 * The call that creates what the module exports as `name`, a variable or its default export, as `defineBrokerTest()`;
 * null for other values.
 */
function creatingCall(program: Program, name: string, source: SourceText): string | null {
  const own = ownExport(program, name);
  const local = own?.kind === 'variable' ? name : own?.kind === 'specifier' && own.source === null ? own.local : null;
  const declarator = topLevelDeclarators(program).find(
    (item) => item.id.type === 'Identifier' && item.id.name === local,
  );
  const written = own?.kind === 'default' ? own.value : declarator?.init;
  const init = written ? unwrap(written) : null;
  const value = init?.type === 'AwaitExpression' ? unwrap(init.argument) : init;
  return value?.type === 'CallExpression' ? `${snippet(source.slice(value.callee.start, value.callee.end))}()` : null;
}

/** Follows the import of `name` in a test file, with the diagnostic to report when it isn't a test object. */
export function followImport(
  name: string,
  imported: ModuleImport,
  readModule: ModuleReader | null,
  file: FileContext,
  framework: Framework,
): { exported: boolean; problem: Problem | null } {
  const { exported, reason } = followModule(imported.source, imported.imported, readModule, framework);
  const problemFound = reason
    ? problem(
        'unresolved-test-import',
        imported.node,
        `'${name}' is imported from '${imported.source}', which ${reason}; tests that use it are missing.`,
        snippet(text(file, imported.node)),
      )
    : null;
  return { exported, problem: problemFound };
}
