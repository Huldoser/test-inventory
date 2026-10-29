import { visitorKeys, type Node, type Program } from 'oxc-parser';
import { childNodes, type FunctionNode } from './ast.ts';
import type { Extraction, Frame, PendingSuite, PendingTest, Scope } from './extract.ts';
import { exportName, parseModule } from './frameworks/bindings.ts';
import { problem } from './frameworks/common.ts';
import { shortHash, hashNodes } from './hash.ts';
import type { ModuleReader, ModuleSource, Problem, Span } from './model.ts';
import type { ParsedFile } from './parse.ts';
import { snippet, type SourceText } from './source.ts';
import { bindingNames, isScopeNode, Values } from './values.ts';

/** A file whose code a test can run: the scanned file, a module it imports, or a data file such as JSON. */
interface Module {
  relativeFilePath: string;
  /** Null for a file that isn't JavaScript or TypeScript, which is taken by its text. */
  parsed: ParsedFile | null;
  /** The file's text with line endings read as `\n`, for a file that isn't code. */
  text: string | null;
  values: Values;
  readModule: ModuleReader | null;
  /** Its top-level statements that run when it is imported, and the modules it imports, which run then too. */
  load: [Unit | null, Unit | null];
  /** All of it, for a module used in ways the scan can't narrow down to declarations. */
  whole: [Unit | null, Unit | null];
}

/** Code to hash, with the scopes around each node, so that the names it uses can be followed to their declarations. */
interface Root {
  node: Node;
  scopes: readonly Node[];
}

/** A piece of code a test may run, and the pieces it uses in turn. */
interface Unit {
  module: Module;
  roots: Root[];
  /** Nodes left out, given as end by start: the tests and describes in a file's or a describe's own code. */
  cut: ReadonlyMap<number, number>;
  /** Whether names in types are followed too, for type tests. */
  types: boolean;
  /** Extra units it always brings in, such as the code its module runs when it is imported. */
  with: Unit[];
  edges: Set<Unit> | null;
  unfollowed: Place[];
  hash: string | null | undefined;
}

/** Something a test reaches that the scan can't follow. */
export interface Place {
  relativeFilePath: string;
  source: SourceText;
  problem: Problem;
  /** Not reported, as when one file's code is scanned and no import is read: the test record says enough. */
  isQuiet: boolean;
}

/** What a test runs, as the test record gives it. */
export interface Dependencies {
  hash: string;
  files: string[];
  isComplete: boolean;
}

/** Statements that only declare something: they run code only when what they declare is used. */
const DECLARATIONS = new Set([
  'ImportDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'VariableDeclaration',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
  'TSDeclareFunction',
  'TSImportEqualsDeclaration',
  'ExportAllDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'EmptyStatement',
]);

/** Keys that hold types, which don't run. */
const TYPE_KEYS = new Set([
  'typeAnnotation',
  'returnType',
  'typeParameters',
  'typeArguments',
  'superTypeArguments',
  'implements',
]);

const TYPES = new Set(['TSInterfaceDeclaration', 'TSTypeAliasDeclaration']);

/** Reasons the resolver gives for an installed package, whose code the hash leaves out on purpose. */
const PACKAGE_REASONS = new Set([
  'is an installed package, which is not followed',
  'is not a local file, a path alias or a workspace package',
]);

const CODE_FILE = /\.[cm]?[jt]sx?$/;

function isLocalSpecifier(specifier: string): boolean {
  return /^\.\.?(?:\/|$)/.test(specifier) || specifier.startsWith('#');
}

function contains(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/** The scopes around a node, outermost first, found by going down from the program to it. */
function scopesAt(program: Program, target: Node): Node[] {
  const scopes: Node[] = [];
  let node: Node = program;
  while (node !== target) {
    if (isScopeNode(node)) scopes.push(node);
    // The target is in the program, so one child always holds it.
    node = childNodes(node).find((child) => contains(child, target)) as Node;
  }
  return scopes;
}

/** Where a statement's own declaration is, for a statement that exports one. */
function declared(statement: Node): Node {
  return statement.type === 'ExportNamedDeclaration' && statement.declaration ? statement.declaration : statement;
}

/**
 * Follows what each test runs, across the files of one scan: its call, the code around it, and every declaration
 * that code uses, in its own file and through imports. Each piece is read once per scan, however many tests reach it.
 */
export class DependencyGraph {
  private readonly modules = new WeakMap<ParsedFile | ModuleSource, Module>();
  private readonly units: [WeakMap<Node, Unit>, WeakMap<Node, Unit>] = [new WeakMap(), new WeakMap()];
  /** Places already reported, so that one the scan reaches from many files is reported once. */
  private readonly reported = new Set<string>();

  /** The module of a file the scan reads code from, given as its parsed file. */
  module(parsed: ParsedFile, relativeFilePath: string, values: Values, readModule: ModuleReader | null): Module {
    let module = this.modules.get(parsed);
    if (!module) {
      module = { relativeFilePath, parsed, text: null, values, readModule, load: [null, null], whole: [null, null] };
      this.modules.set(parsed, module);
    }
    return module;
  }

  /**
   * Code a test or a describe runs, written in `module`. `cut` lists the nodes left out, such as the tests in a
   * describe.
   */
  unit(module: Module, nodes: Node[], cut: Span[], types: boolean): Unit {
    const program = (module.parsed as ParsedFile).program;
    return this.newUnit(
      module,
      nodes.map((node) => ({ node, scopes: scopesAt(program, node) })),
      new Map(cut.map((span) => [span.start, span.end])),
      types,
    );
  }

  /** The code a file runs when it is loaded, leaving out the tests and describes at `cut`. */
  loadUnit(module: Module, types: boolean, cut: Span[] = []): Unit {
    const index = Number(types);
    const cached = module.load[index];
    if (cached) return cached;
    const program = (module.parsed as ParsedFile).program;
    const statements = program.body.filter((statement) => !DECLARATIONS.has(statement.type));
    const unit = this.newUnit(
      module,
      statements.map((node) => ({ node, scopes: [program] })),
      new Map(cut.map((span) => [span.start, span.end])),
      types,
    );
    module.load[index] = unit;
    return unit;
  }

  /** Everything a set of units reaches: its hash, its files, and whether all of it could be followed. */
  dependencies(roots: Unit[], report: (place: Place) => void): Dependencies {
    const reached = new Set<Unit>();
    const pending = [...roots];
    for (let unit = pending.pop(); unit; unit = pending.pop()) {
      if (reached.has(unit)) continue;
      reached.add(unit);
      unit.edges ??= this.edgesOf(unit);
      pending.push(...unit.with, ...unit.edges);
    }
    const byFile = new Map<string, { start: number; hash: string }[]>();
    let isComplete = true;
    for (const unit of reached) {
      for (const place of unit.unfollowed) {
        isComplete = false;
        if (place.isQuiet) continue;
        const key = `${place.relativeFilePath}\0${(place.problem.node as Span).start}\0${place.problem.message}`;
        if (this.reported.has(key)) continue;
        this.reported.add(key);
        report(place);
      }
      const hash = this.hashOf(unit);
      if (hash === null) continue;
      const parts = byFile.get(unit.module.relativeFilePath) ?? [];
      parts.push({ start: unit.roots[0]?.node.start ?? 0, hash });
      byFile.set(unit.module.relativeFilePath, parts);
    }
    const files = [...byFile.keys()].sort();
    const parts = files.map((file) => [
      file,
      (byFile.get(file) as { start: number; hash: string }[])
        .sort((a, b) => a.start - b.start || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
        .map((part) => part.hash),
    ]);
    return { hash: shortHash(JSON.stringify(parts)), files, isComplete };
  }

  private newUnit(module: Module, roots: Root[], cut: ReadonlyMap<number, number>, types: boolean): Unit {
    return { module, roots, cut, types, with: [], edges: null, unfollowed: [], hash: undefined };
  }

  private hashOf(unit: Unit): string | null {
    if (unit.hash === undefined) {
      if (unit.module.text !== null) {
        unit.hash = shortHash(unit.module.text);
      } else {
        const cut = [...unit.cut].map(([start, end]) => ({ start, end }));
        unit.hash = hashNodes(
          unit.roots.map((root) => root.node),
          cut,
        );
      }
    }
    return unit.hash;
  }

  /** The module a file imports, read and parsed once per scan. */
  private moduleOf(source: ModuleSource): Module {
    let module = this.modules.get(source);
    if (!module) {
      if (CODE_FILE.test(source.relativeFilePath)) {
        const parsed = parseModule(source);
        module = this.modules.get(parsed) ?? {
          relativeFilePath: source.relativeFilePath,
          parsed,
          text: null,
          values: new Values(),
          readModule: source.readModule,
          load: [null, null],
          whole: [null, null],
        };
        this.modules.set(parsed, module);
      } else {
        module = {
          relativeFilePath: source.relativeFilePath,
          parsed: null,
          text: source.code.replace(/\r\n?/g, '\n'),
          values: new Values(),
          readModule: null,
          load: [null, null],
          whole: [null, null],
        };
      }
      this.modules.set(source, module);
    }
    return module;
  }

  private textUnit(module: Module): Unit {
    const cached = module.whole[0];
    if (cached) return cached;
    const unit = this.newUnit(module, [], new Map(), false);
    unit.edges = new Set();
    module.whole[0] = unit;
    module.whole[1] = unit;
    module.load[0] = unit;
    module.load[1] = unit;
    return unit;
  }

  private wholeUnit(module: Module, types: boolean): Unit {
    const index = Number(types);
    const cached = module.whole[index];
    if (cached) return cached;
    const program = (module.parsed as ParsedFile).program;
    const statements = program.body.filter((statement) => statement.type !== 'ImportDeclaration');
    const unit = this.newUnit(
      module,
      statements.map((node) => ({ node, scopes: [program] })),
      new Map(),
      types,
    );
    unit.with.push(this.loadUnit(module, types));
    module.whole[index] = unit;
    return unit;
  }

  /** The unit of a declaration: a declarator, function, class or enum, or the function a parameter belongs to. */
  private declarationUnit(module: Module, declaration: Node, types: boolean): Unit {
    const cache = this.units[Number(types)];
    let unit = cache.get(declaration);
    if (!unit) {
      const program = (module.parsed as ParsedFile).program;
      unit = this.newUnit(module, [{ node: declaration, scopes: scopesAt(program, declaration) }], new Map(), types);
      // Code in a module runs only once the module is loaded, which runs its top-level statements.
      unit.with.push(this.loadUnit(module, types));
      cache.set(declaration, unit);
    }
    return unit;
  }

  private unfollowed(unit: Unit, at: Span, message: string, isQuiet = false): void {
    const { module } = unit;
    const parsed = module.parsed as ParsedFile;
    const text = snippet(parsed.source.slice(at.start, at.end));
    unit.unfollowed.push({
      relativeFilePath: module.relativeFilePath,
      source: parsed.source,
      problem: problem('dependency-not-followed', at, message, text),
      isQuiet,
    });
  }

  /**
   * The units a module export stands for, read from the module a specifier names. Installed packages give none; a
   * local module that can't be read is reported at `at`.
   */
  private imported(unit: Unit, from: Module, specifier: string, name: string, at: Span): Unit[] {
    const read: ReturnType<ModuleReader> | null = from.readModule ? from.readModule(specifier) : null;
    if (read === null) {
      if (isLocalSpecifier(specifier)) this.unfollowed(unit, at, `'${specifier}' is not read.`, true);
      return [];
    }
    if ('reason' in read) {
      if (!PACKAGE_REASONS.has(read.reason)) {
        this.unfollowed(unit, at, `'${specifier}' ${read.reason}, so dependencyHash doesn't cover it.`);
      }
      return [];
    }
    const module = this.moduleOf(read);
    if (module.parsed === null) return [this.textUnit(module)];
    if (module.parsed.error) {
      this.unfollowed(unit, at, `'${specifier}' could not be parsed, so dependencyHash doesn't cover it.`);
      return [];
    }
    return name === '' ? [this.loadUnit(module, unit.types)] : this.exported(unit, module, name, new Set());
  }

  /**
   * The units of what a module exports under a name, followed through re-exports. `*` is the whole module. A name the
   * scan can't find, as with CommonJS exports, also takes the whole module, so that nothing it may run is left out.
   */
  private exported(unit: Unit, module: Module, name: string, searched: Set<Module>): Unit[] {
    const { types } = unit;
    if (name === '*' || searched.has(module)) return [this.wholeUnit(module, types)];
    searched.add(module);
    const program = (module.parsed as ParsedFile).program;
    const local = (localName: string): Unit[] => {
      const declaration = module.values.declarationOf(localName, [program]);
      // A global the module re-exports, such as `structuredClone`, has no code in the project.
      if (declaration === null) return [];
      return this.toDeclaration(unit, module, declaration, null);
    };
    for (const statement of program.body) {
      if (statement.type === 'ExportDefaultDeclaration' && name === 'default') {
        const declaration = statement.declaration;
        return declaration.type === 'Identifier'
          ? local(declaration.name)
          : [this.declarationUnit(module, declaration, types)];
      }
      if (statement.type === 'ExportAllDeclaration') {
        const source = statement.source.value;
        if (statement.exported) {
          if (exportName(statement.exported) === name) return this.imported(unit, module, source, '*', statement);
          continue;
        }
        const found = this.reexported(unit, module, source, name, searched);
        if (found) return found;
        continue;
      }
      if (statement.type !== 'ExportNamedDeclaration') continue;
      if (statement.exportKind === 'type' && !types) continue;
      const declaration = statement.declaration;
      if (declaration) {
        if (declaration.type === 'VariableDeclaration') {
          const declarator = declaration.declarations.find((item) => bindingNames(item.id).includes(name));
          if (declarator) return [this.declarationUnit(module, declarator, types)];
        } else if ('id' in declaration && declaration.id?.type === 'Identifier' && declaration.id.name === name) {
          return [this.declarationUnit(module, declaration, types)];
        }
        continue;
      }
      const specifier = statement.specifiers.find((item) => exportName(item.exported) === name);
      if (!specifier) continue;
      const localName = exportName(specifier.local);
      return statement.source
        ? this.imported(unit, module, statement.source.value, localName, statement)
        : local(localName);
    }
    return [this.wholeUnit(module, types)];
  }

  /** What `export * from source` gives for a name; null when the module behind it doesn't export it. */
  private reexported(unit: Unit, from: Module, source: string, name: string, searched: Set<Module>): Unit[] | null {
    const read = from.readModule?.(source);
    if (!read || 'reason' in read) return null;
    const module = this.moduleOf(read);
    if (module.parsed === null || module.parsed.error) return null;
    const found = this.exported(unit, module, name, searched);
    // A module that doesn't export the name falls back to the whole of it, which doesn't count as found here.
    return found.length === 1 && found[0] === module.whole[Number(unit.types)] ? null : found;
  }

  /** The units a name stands for where it is declared: the declaration, or the export of the module it's imported from. */
  private toDeclaration(unit: Unit, module: Module, declaration: Node, member: string | null): Unit[] {
    if (declaration.type === 'ImportSpecifier' || declaration.type === 'ImportDefaultSpecifier') {
      const statement = this.importOf(module, declaration);
      const imported = declaration.type === 'ImportSpecifier' ? exportName(declaration.imported) : 'default';
      return this.imported(unit, module, statement.source.value, imported, statement);
    }
    if (declaration.type === 'ImportNamespaceSpecifier') {
      const statement = this.importOf(module, declaration);
      return this.imported(unit, module, statement.source.value, member ?? '*', statement);
    }
    return [this.declarationUnit(module, declaration, unit.types)];
  }

  private importOf(module: Module, specifier: Node): Extract<Node, { type: 'ImportDeclaration' }> {
    const program = (module.parsed as ParsedFile).program;
    return program.body.find(
      (statement) => statement.type === 'ImportDeclaration' && contains(statement, specifier),
    ) as Extract<Node, { type: 'ImportDeclaration' }>;
  }

  /** The units a unit uses directly: the declarations its names refer to, and the modules it loads. */
  private edgesOf(unit: Unit): Set<Unit> {
    const edges = new Set<Unit>();
    const { module } = unit;
    const program = (module.parsed as ParsedFile).program;
    const isOwn = (declaration: Node) => unit.roots.some((root) => contains(root.node, declaration));
    const follow = (name: string, scopes: readonly Node[], member: string | null) => {
      const declaration = module.values.declarationOf(name, scopes) ?? otherDeclaration(name, scopes, unit.types);
      if (declaration === null || isOwn(declaration)) return;
      for (const target of this.toDeclaration(unit, module, declaration, member)) edges.add(target);
    };
    const load = (specifier: string, at: Span) => {
      for (const target of this.imported(unit, module, specifier, '', at)) edges.add(target);
    };
    const whole = (specifier: string, at: Span) => {
      for (const target of this.imported(unit, module, specifier, '*', at)) edges.add(target);
    };
    const walk = (node: Node, scopes: Node[], key: string | null, parent: Node | null): void => {
      if (unit.cut.get(node.start) === node.end) return;
      switch (node.type) {
        case 'Identifier':
          if (isReference(key, parent)) follow(node.name, scopes, null);
          break;
        case 'JSXIdentifier':
          if ((key === 'name' || key === 'object') && /^[A-Z_$]/.test(node.name)) follow(node.name, scopes, null);
          return;
        case 'MemberExpression':
          // `pages.OrderTicket` on a namespace import needs only that export.
          if (!node.computed && node.object.type === 'Identifier') {
            follow(node.object.name, scopes, node.property.name);
            return;
          }
          break;
        case 'ImportExpression':
        case 'CallExpression': {
          const target = node.type === 'ImportExpression' ? node.source : requireArgument(node, module.values, scopes);
          if (target === undefined) break;
          if (target !== null && target.type === 'Literal' && typeof target.value === 'string') {
            whole(target.value, node);
          } else {
            this.unfollowed(
              unit,
              node,
              "The module this loads is worked out at run time, so dependencyHash doesn't cover it.",
            );
          }
          break;
        }
        case 'ImportDeclaration':
          if (node.importKind !== 'type' || unit.types) load(node.source.value, node);
          return;
        // Re-exports, in a module taken whole: each name comes from the other module.
        case 'ExportNamedDeclaration':
          if (!node.source) break;
          if (node.exportKind !== 'type' || unit.types) {
            for (const specifier of node.specifiers) {
              const name = exportName(specifier.local);
              for (const target of this.imported(unit, module, node.source.value, name, node)) edges.add(target);
            }
          }
          return;
        case 'ExportAllDeclaration':
          if (node.exportKind !== 'type' || unit.types) whole(node.source.value, node);
          return;
      }
      const isScope = isScopeNode(node);
      if (isScope) scopes.push(node);
      const fields = node as unknown as Record<string, unknown>;
      for (const field of visitorKeys[node.type]) {
        if (!unit.types && TYPE_KEYS.has(field)) continue;
        const value = fields[field];
        if (Array.isArray(value)) {
          for (const item of value as (Node | null)[]) if (item) walk(item, scopes, field, node);
        } else if (value) {
          walk(value as Node, scopes, field, node);
        }
      }
      if (isScope) scopes.pop();
    };
    for (const root of unit.roots) walk(root.node, [...root.scopes], null, null);
    // A module's imports run when it is loaded, whatever of them it uses.
    if (unit === module.load[Number(unit.types)]) {
      for (const statement of program.body) {
        if (statement.type === 'ImportDeclaration') walk(statement, [program], null, null);
        if (
          (statement.type === 'ExportAllDeclaration' || statement.type === 'ExportNamedDeclaration') &&
          statement.source
        ) {
          if (statement.exportKind !== 'type' || unit.types) load(statement.source.value, statement);
        }
      }
    }
    return edges;
  }
}

/** Whether an identifier refers to a binding, rather than naming a property, a label or a member. */
function isReference(key: string | null, parent: Node | null): boolean {
  switch (parent?.type) {
    case 'MemberExpression':
      return key === 'object' || parent.computed;
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
    case 'AccessorProperty':
    case 'TSPropertySignature':
    case 'TSMethodSignature':
      return key !== 'key' || parent.computed;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return false;
    case 'TSEnumMember':
    case 'TSModuleDeclaration':
    case 'TSTypeParameter':
      return key !== 'id' && key !== 'name';
    case 'TSQualifiedName':
      return key === 'left';
    case 'ExportSpecifier':
      return key === 'local';
    case 'MetaProperty':
      return false;
    default:
      return true;
  }
}

/**
 * The first argument of a call to the global `require()`; null when it has none or spreads its arguments, undefined
 * when the call is to something else.
 */
function requireArgument(
  node: Extract<Node, { type: 'CallExpression' }>,
  values: Values,
  scopes: readonly Node[],
): Node | null | undefined {
  const { callee } = node;
  if (callee.type !== 'Identifier' || callee.name !== 'require' || values.declarationOf('require', scopes)) {
    return undefined;
  }
  const argument = node.arguments.at(0);
  return argument && argument.type !== 'SpreadElement' ? argument : null;
}

/**
 * A namespace a name refers to, or for a type test also an interface or type alias, looked up in the scopes around
 * it. Imports, classes and enums are bindings `Values` already finds.
 */
function otherDeclaration(name: string, scopes: readonly Node[], types: boolean): Node | null {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    const body =
      scope.type === 'Program' || scope.type === 'BlockStatement' || scope.type === 'TSModuleBlock' ? scope.body : [];
    for (const statement of body) {
      const node = declared(statement);
      const isNamed = 'id' in node && node.id?.type === 'Identifier' && node.id.name === name;
      if (isNamed && (node.type === 'TSModuleDeclaration' || (types && TYPES.has(node.type)))) return node;
    }
  }
  return null;
}

/** The statements of a describe's callback, or its expression when it has no block body. */
function bodyNodes(fn: FunctionNode): Node[] {
  const body = fn.body as Node;
  return body.type === 'BlockStatement' ? body.body : [body];
}

/**
 * What each test of a scanned file runs: its own call, the helper call that registers it, every describe around it
 * with its hooks and options, the file's own top-level code, and what all of these reach. `report` gets each place the
 * scan can't follow, once per scan.
 */
export function fileDependencies(
  graph: DependencyGraph,
  main: Frame,
  extraction: Extraction,
  types: boolean,
  report: (place: Place) => void,
): (test: PendingTest) => Dependencies {
  const moduleOf = (frame: Frame) => graph.module(frame.parsed, frame.relativeFilePath, frame.values, frame.readModule);
  const mainModule = moduleOf(main);
  // The file's tests and describes, and the helper calls that declare them, are each test's own, not code every test
  // in the file or a describe runs.
  const items = [...extraction.tests, ...extraction.suites];
  const registered = items.flatMap((item) => (item.registeredBy ? [item.registeredBy] : []));
  const load = graph.loadUnit(mainModule, types, [
    ...items.flatMap((item) => (item.frame === main ? [item.call] : [])),
    ...registered,
  ]);
  const registering = (call: Node | null) => (call ? [graph.unit(mainModule, [call], [], types)] : []);
  const suiteUnits = new Map<PendingSuite, Unit[]>();
  const suiteUnit = (suite: PendingSuite): Unit[] => {
    let units = suiteUnits.get(suite);
    if (!units) {
      // A describe without a callback has no tests in it.
      const fn = suite.declaration.fn as FunctionNode;
      const setup = bodyNodes(fn).filter((node) => !DECLARATIONS.has(node.type));
      units = [
        graph.unit(
          moduleOf(suite.frame),
          [suite.call, ...setup],
          // Offsets in another file could match these by chance.
          [fn, ...suite.cuts, ...(suite.frame === main ? registered : [])],
          types,
        ),
        ...registering(suite.registeredBy),
      ];
      suiteUnits.set(suite, units);
    }
    return units;
  };
  return (test) => {
    const roots = [graph.unit(moduleOf(test.frame), [test.call], [], types), load, ...registering(test.registeredBy)];
    for (let scope: Scope | null = test.scope; scope; scope = scope.parent) {
      if (scope.suite) roots.push(...suiteUnit(scope.suite));
    }
    return graph.dependencies(roots, report);
  };
}
