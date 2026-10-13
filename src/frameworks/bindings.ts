import type { Expression, ModuleExportName, Node, Program, VariableDeclarator } from 'oxc-parser';
import { childNodes, propertyName, unwrap } from '../ast.ts';
import type { ModuleReader, ModuleSource, Problem } from '../model.ts';
import { parseFile, type ParsedFile } from '../parse.ts';
import { snippet } from '../source.ts';
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

/** Names a module's test objects are known by, used to check what a fixtures file exports. */
export interface TestObjects {
  isTestObject(expression: Expression): boolean;
  isTestName(name: string): boolean;
  /** Whether re-exporting `imported` from `source` exports a test object. */
  reexports(source: string, imported: string): boolean;
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

/** Whether a module exports `name` as a test object. */
export function exportsTestObject(program: Program, name: string, objects: TestObjects): boolean {
  for (const statement of program.body) {
    switch (statement.type) {
      case 'ExportNamedDeclaration':
        if (statement.declaration?.type === 'VariableDeclaration') {
          for (const declarator of statement.declaration.declarations) {
            if (declarator.id.type === 'Identifier' && declarator.id.name === name) {
              return objects.isTestName(name);
            }
          }
        }
        for (const specifier of statement.specifiers) {
          if (exportName(specifier.exported) !== name) continue;
          const local = exportName(specifier.local);
          return statement.source ? objects.reexports(statement.source.value, local) : objects.isTestName(local);
        }
        break;
      case 'ExportDefaultDeclaration':
        if (name === 'default') return objects.isTestObject(statement.declaration as Expression);
        break;
      case 'ExportAllDeclaration':
        if (!statement.exported && objects.reexports(statement.source.value, name)) return true;
        break;
      case 'ExpressionStatement': {
        const source = commonJsReexport(statement);
        if (source !== null && objects.reexports(source, name)) return true;
        break;
      }
    }
  }
  return false;
}

/** Where a module gets a name it exports from another module, and how: by re-exporting it or by building on it. */
interface ImportOrigin {
  source: string;
  imported: string;
  how: 're-exports' | 'builds';
}

/**
 * The module and name a module's export comes from when it re-exports it, as in `export { test } from './base'`, or
 * builds it from something imported, directly or through its own variables, as in `const test = base.extend({...})`.
 */
function importOrigin(program: Program, name: string, isFramework: (source: string) => boolean): ImportOrigin | null {
  const imported = moduleImports(program, isFramework);
  for (const statement of program.body) {
    const required = commonJsReexport(statement);
    if (required !== null && !isFramework(required)) return { source: required, imported: name, how: 're-exports' };
    if (statement.type === 'ExportAllDeclaration' && !statement.exported && !isFramework(statement.source.value)) {
      return { source: statement.source.value, imported: name, how: 're-exports' };
    }
    if (statement.type !== 'ExportNamedDeclaration') continue;
    for (const specifier of statement.specifiers) {
      if (exportName(specifier.exported) !== name) continue;
      const local = exportName(specifier.local);
      // `export { test } from './fixtures'`, or `import { test } from './fixtures'` and then `export { test }`.
      if (statement.source) {
        if (isFramework(statement.source.value)) continue;
        return { source: statement.source.value, imported: local, how: 're-exports' };
      }
      const from = imported.get(local);
      if (from) return { source: from.source, imported: from.imported, how: 're-exports' };
    }
  }
  const values = new Map<string, Node>();
  for (const declarator of topLevelDeclarators(program)) {
    if (declarator.id.type === 'Identifier' && declarator.init) values.set(declarator.id.name, declarator.init);
  }
  const seen = new Set<string>();
  // The import a local name is, or is built from: the object `extend` is called on, the test objects a call such as
  // `mergeTests(a, b)` combines, either side of `?:`, or another local name. Values only passed along, such as a
  // fixtures object in `base.extend(fixtures)`, are not what the test object is built on.
  const builtFrom = (local: string): ModuleImport | null => {
    const value = values.get(local);
    if (imported.has(local) || !value || seen.has(local)) return imported.get(local) ?? null;
    seen.add(local);
    return builtOn(value);
  };
  const builtOn = (node: Node): ModuleImport | null => {
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
    if (found) return { source: found.source, imported: found.imported, how: 'builds' };
  }
  return null;
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
export type FollowImport = (source: string, imported: string) => boolean;

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
 * nothing to do with the framework, as when a call only looked like a test.
 */
export function followModule(
  source: string,
  name: string,
  readModule: ModuleReader | null,
  framework: Framework,
  path: readonly string[] = [],
): { exported: boolean; reason: string | null } {
  // Without a reader, as in scanSource, nothing can be read.
  const module = readModule ? readModule(source) : { reason: 'could not be read' };
  if ('reason' in module) return { exported: false, reason: module.reason };
  if (path.includes(module.relativeFilePath)) return { exported: false, reason: 'imports it back, in a cycle' };
  if (path.length >= MAX_DEPTH) return { exported: false, reason: `is more than ${MAX_DEPTH} modules deep` };
  const { program, error } = parseModule(module);
  if (error) return { exported: false, reason: 'could not be parsed' };
  const within = [...path, module.relativeFilePath];
  const results = new Map<string, { exported: boolean; reason: string | null }>();
  const followFrom = (from: string, imported: string) => {
    const key = `${from}\0${imported}`;
    let result = results.get(key);
    if (!result) {
      result = followModule(from, imported, module.readModule, framework, within);
      results.set(key, result);
    }
    return result;
  };
  const objects = framework.testObjects(program, (from, imported) => followFrom(from, imported).exported);
  if (exportsTestObject(program, name, objects)) return { exported: true, reason: null };
  const unrecognized = `does not export a ${framework.name} test object that could be recognized`;
  const origin = importOrigin(program, name, framework.isSource);
  if (origin) {
    const end = followFrom(origin.source, origin.imported).reason ?? unrecognized;
    return { exported: false, reason: `${origin.how} it from '${origin.source}', which ${end}` };
  }
  return { exported: false, reason: importsFrom(program, framework.isSource) ? unrecognized : null };
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
