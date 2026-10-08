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

/** Whether a module re-exports `name` from another module, which the scan does not follow. */
export function reexportsFromModule(program: Program, name: string, isFramework: (source: string) => boolean): boolean {
  const imported = moduleImports(program, isFramework);
  return program.body.some((statement) => {
    const required = commonJsReexport(statement);
    if (required !== null) return !isFramework(required);
    if (statement.type === 'ExportAllDeclaration') return !statement.exported && !isFramework(statement.source.value);
    if (statement.type !== 'ExportNamedDeclaration') return false;
    // `export { test } from './fixtures'`, or `import { test } from './fixtures'` and then `export { test }`.
    const fromModule = (local: string) =>
      statement.source ? !isFramework(statement.source.value) : imported.has(local);
    return statement.specifiers.some(
      (specifier) => exportName(specifier.exported) === name && fromModule(exportName(specifier.local)),
    );
  });
}

/**
 * Whether a module exports `name` as a value built from something imported from another module, directly or through
 * its own variables, as in `const test = baseTest.extend({...})` and then `export const browserTest = test`.
 */
export function buildsFromModule(program: Program, name: string, isFramework: (source: string) => boolean): boolean {
  const imported = moduleImports(program, isFramework);
  const values = new Map<string, Node>();
  for (const declarator of topLevelDeclarators(program)) {
    if (declarator.id.type === 'Identifier' && declarator.init) values.set(declarator.id.name, declarator.init);
  }
  const seen = new Set<string>();
  const builtFromImport = (local: string): boolean => {
    const value = values.get(local);
    if (!value || seen.has(local)) return false;
    seen.add(local);
    return usesImport(value);
  };
  const usesImport = (node: Node): boolean =>
    (node.type === 'Identifier' && (imported.has(node.name) || builtFromImport(node.name))) ||
    childNodes(node).some(usesImport);
  // `export { test as browserTest }` exports a variable under another name.
  const locals = program.body.flatMap((statement) =>
    statement.type === 'ExportNamedDeclaration' && !statement.source
      ? statement.specifiers.filter((item) => exportName(item.exported) === name).map((item) => exportName(item.local))
      : [],
  );
  return [name, ...locals].some(builtFromImport);
}

/** Whether a module imports or requires any of the given sources. */
export function importsFrom(program: Program, matches: (source: string) => boolean): boolean {
  const requires = (node: Node): boolean => {
    const source = node.type === 'CallExpression' ? requiredModule(node) : null;
    return (source !== null && matches(source)) || childNodes(node).some(requires);
  };
  return program.body.some(
    (statement) => (statement.type === 'ImportDeclaration' && matches(statement.source.value)) || requires(statement),
  );
}

/** How a framework recognizes the modules and test objects of a followed file. */
export interface Framework {
  name: string;
  isSource: (source: string) => boolean;
  testObjects: (program: Program) => TestObjects;
}

/** Parsed modules, kept while their source is, so that a fixtures file many tests import is parsed once. */
const parsedModules = new WeakMap<ModuleSource, ParsedFile>();

function parseModule(module: ModuleSource): ParsedFile {
  let parsed = parsedModules.get(module);
  if (!parsed) {
    parsed = parseFile(module.relativeFilePath, module.code);
    parsedModules.set(module, parsed);
  }
  return parsed;
}

/**
 * Follows one import to see whether the module exports a test object. Only one level is followed. A module that has
 * nothing to do with the framework is not reported: the call only looked like a test.
 */
export function followImport(
  name: string,
  imported: ModuleImport,
  readModule: ModuleReader | null,
  file: FileContext,
  framework: Framework,
): { exported: boolean; problem: Problem | null } {
  const unresolved = (reason: string) =>
    problem(
      'unresolved-test-import',
      imported.node,
      `'${name}' is imported from '${imported.source}', which ${reason}; tests that use it are missing.`,
      snippet(text(file, imported.node)),
    );
  // Without a reader, as in scanSource, nothing can be read.
  const module = readModule ? readModule(imported.source) : { reason: 'could not be read' };
  if ('reason' in module) return { exported: false, problem: unresolved(module.reason) };
  const { program, error } = parseModule(module);
  if (error) return { exported: false, problem: unresolved('could not be parsed') };
  if (exportsTestObject(program, imported.imported, framework.testObjects(program))) {
    return { exported: true, problem: null };
  }
  let reason: string | null = null;
  if (reexportsFromModule(program, imported.imported, framework.isSource)) {
    reason = 're-exports it from another module, which is not followed';
  } else if (buildsFromModule(program, imported.imported, framework.isSource)) {
    reason = 'builds it from another module, which is not followed';
  } else if (importsFrom(program, framework.isSource)) {
    reason = `does not export a ${framework.name} test object that could be recognized`;
  }
  return { exported: false, problem: reason ? unresolved(reason) : null };
}
