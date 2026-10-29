import {
  visitorKeys,
  type CallExpression,
  type Expression,
  type Node,
  type Program,
  type ObjectProperty,
  type VariableDeclarator,
} from 'oxc-parser';
import { childNodes, isFunctionNode, propertyKey, unwrap, type FunctionNode } from './ast.ts';
import type { Extraction, Frame, PendingSuite, PendingTest, Scope } from './extract.ts';
import { exportName, parseModule } from './frameworks/bindings.ts';
import { destructuredNames, problem, takesWhole } from './frameworks/common.ts';
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
  /** Its top-level code that runs when it is imported, and the modules it imports, which run then too. */
  load: [Unit | null, Unit | null];
  /** All of it, for a module used in ways the scan can't narrow down to declarations. */
  whole: [Unit | null, Unit | null];
  /** What each import in the module stands for, as it is asked for once per test file that reaches it. */
  imports: Map<string, Unit[]>;
  /** The module each specifier names, as a barrel's `export *` is searched once for every name imported through it. */
  reads: Map<string, ReturnType<ModuleReader>>;
}

/** Code to hash, with the scopes around each node, so that the names it uses can be followed to their declarations. */
interface Root {
  node: Node;
  scopes: readonly Node[];
}

/**
 * A piece of code a test may run, and the pieces it uses in turn. A unit with a `place` and no code stands for
 * something the scan can't follow.
 */
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
  place: Place | null;
  /** For a test object built with `extend()`, the fixtures left out of its code. */
  fixtures: Fixtures | null;
  /** Fills in `roots` and `with` when the walk first reaches the unit. */
  prepare: (() => void) | null;
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

/** The units some roots reach, the hashes of their code by file, each list sorted, and the places among them. */
interface Reach {
  units: Set<Unit>;
  byFile: Map<string, string[]>;
  places: Place[];
  /** The fixtures of the test objects among the units, which each test takes as it needs them. */
  fixtures: Fixtures[];
}

/** A fixture one `extend()` call defines, and the fixtures it asks for; null when it takes them whole. */
interface Fixture {
  unit: Unit;
  uses: string[] | null;
}

/** The fixtures a test object's own `extend()` calls define, left out of the object's unit and taken per test. */
interface Fixtures {
  byName: Map<string, Fixture[]>;
  /** Fixtures with `auto: true`, which run for every test that uses the object. */
  auto: string[];
}

/** The fixtures a test asks for: its own, and those of the hooks around it. */
export interface FixtureNeeds {
  names: string[];
  /** The test or a hook takes its fixtures whole, so it may use any. */
  all: boolean;
}

/** What a test runs, as the test record gives it. */
export interface Dependencies {
  hash: string;
  files: string[];
  isComplete: boolean;
}

/** Statements that only declare something, unless code in them runs while they are evaluated. */
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

/** Expressions that run code other than the declaration's own: calls, constructors, decorators, static blocks. */
const RUNS = new Set([
  'CallExpression',
  'NewExpression',
  'TaggedTemplateExpression',
  'AwaitExpression',
  'ImportExpression',
  'Decorator',
  'StaticBlock',
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

/** Vitest calls that load or mock a module by its path. */
const VI_MODULE_CALLS = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock']);

/** Reasons the resolver gives for an installed package, whose code the hash leaves out on purpose. */
const PACKAGE_REASONS = new Set([
  'is an installed package, which is not followed',
  'is not a local file, a path alias or a workspace package',
]);

/** Modules whose `test` object fixtures are defined on. */
const FRAMEWORK = /^(?:@playwright\/test|playwright\/test|@playwright\/experimental-ct-[\w-]+|vitest)$/;

/** A property written as `name: value` or `name() {}`, whose name is known. */
function isNamedProperty(property: Node): boolean {
  return property.type === 'Property' && !property.computed && propertyKey(property) !== null;
}

/** `auto: true` in a fixture's options. */
function isAutoOption(property: Node): boolean {
  return (
    property.type === 'Property' &&
    propertyKey(property) === 'auto' &&
    property.value.type === 'Literal' &&
    property.value.value === true
  );
}

const CODE_FILE = /\.[cm]?[jt]sx?$/;

const DECLARATION_FILE = /\.d\.[cm]?ts$/;

/**
 * What an import being looked up stands for while the lookup leads back to it, through re-exports: nothing found
 * there, so that an `export *` goes on to the next module, as the module system does.
 */
const IN_PROGRESS: Unit[] = [];

const COMPUTED = "The module this loads is worked out at run time, so dependencyHash doesn't cover it.";

function isLocalSpecifier(specifier: string): boolean {
  return /^\.\.?(?:\/|$)/.test(specifier) || specifier.startsWith('#');
}

function contains(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/** The path to a node from `from`, searched node by node, for a node outside its parent's span. */
function pathTo(from: Node, target: Node): Node[] | null {
  if (from === target) return [];
  for (const child of childNodes(from)) {
    const path = pathTo(child, target);
    if (path) return [child, ...path];
  }
  return null;
}

/**
 * The scopes around a node, outermost first, found by going down from the program to it. Spans lead the way, except
 * where a node is outside its parent's span, as a decorator written before `export` is.
 */
function scopesAt(program: Program, target: Node): Node[] {
  const scopes: Node[] = [];
  let node: Node = program;
  while (node !== target) {
    if (isScopeNode(node)) scopes.push(node);
    const next: Node | undefined = childNodes(node).find((child) => contains(child, target));
    if (!next) {
      const rest = pathTo(node, target) as Node[];
      scopes.push(...rest.slice(0, -1).filter(isScopeNode));
      break;
    }
    node = next;
  }
  return scopes;
}

/** Where a statement's own declaration is, for a statement that exports one. */
function declared(statement: Node): Node {
  return statement.type === 'ExportNamedDeclaration' && statement.declaration ? statement.declaration : statement;
}

/** Whether evaluating a statement runs code, leaving out the bodies of the functions it declares, which run later. */
function runsOnLoad(node: Node): boolean {
  if (RUNS.has(node.type)) return true;
  // An instance field's value is worked out when the class is built, not when it is defined.
  if ((node.type === 'PropertyDefinition' || node.type === 'AccessorProperty') && !node.static) {
    return node.decorators.length > 0 || (node.computed && runsOnLoad(node.key));
  }
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') return false;
  if (node.type === 'ArrowFunctionExpression') return false;
  return childNodes(node).some(runsOnLoad);
}

/** Whether a top-level or describe statement runs when the file or describe does. */
function isLoadCode(statement: Node): boolean {
  return !DECLARATIONS.has(statement.type) || (statement.type !== 'ImportDeclaration' && runsOnLoad(statement));
}

/**
 * Follows what each test runs, across the files of one scan: its call, the code around it, and every declaration
 * that code uses, in its own file and through imports. Each piece is read once per scan, however many tests reach it.
 */
export class DependencyGraph {
  private readonly modules = new WeakMap<ParsedFile | ModuleSource, Module>();
  private readonly units: [WeakMap<object, Unit>, WeakMap<object, Unit>] = [new WeakMap(), new WeakMap()];
  private readonly testObjects: [WeakMap<Node, Unit | null>, WeakMap<Node, Unit | null>] = [
    new WeakMap(),
    new WeakMap(),
  ];
  /** Places already reported, so that one the scan reaches from many files is reported once. */
  private readonly reported = new Set<string>();

  /** The module of a file the scan reads code from, given as its parsed file. */
  module(parsed: ParsedFile, relativeFilePath: string, values: Values, readModule: ModuleReader | null): Module {
    let module = this.modules.get(parsed);
    if (!module) {
      module = this.newModule(relativeFilePath, parsed, null, values, readModule);
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
    const unit = this.newUnit(module, [], new Map(cut.map((span) => [span.start, span.end])), types);
    // Read once the walk reaches it, as telling a test object apart may need this module's load code in turn.
    unit.prepare = () => {
      for (const statement of program.body.filter(isLoadCode)) {
        const declaration = declared(statement);
        if (declaration.type !== 'VariableDeclaration') {
          unit.roots.push({ node: statement, scopes: [program] });
          continue;
        }
        // A test object's fixtures run only for the tests that ask for them.
        for (const declarator of declaration.declarations) {
          const testObject = this.testObjectUnit(module, declarator, types);
          if (testObject) unit.with.push(testObject);
          else if (runsOnLoad(declarator)) unit.roots.push({ node: declarator, scopes: [program] });
        }
      }
    };
    module.load[index] = unit;
    return unit;
  }

  /** The units a set of roots reaches, leaving out those `skip` reached, with their hashes by file. */
  reach(roots: Unit[], skip: Reach[] = []): Reach {
    const units = new Set<Unit>();
    const pending = [...roots];
    for (let unit = pending.pop(); unit; unit = pending.pop()) {
      if (units.has(unit) || skip.some((reached) => reached.units.has(unit))) continue;
      units.add(unit);
      unit.prepare?.();
      unit.prepare = null;
      unit.edges ??= this.edgesOf(unit);
      pending.push(...unit.with, ...unit.edges);
    }
    const byFile = new Map<string, string[]>();
    const places: Place[] = [];
    const fixtures: Fixtures[] = [];
    for (const unit of units) {
      if (unit.place) places.push(unit.place);
      if (unit.fixtures) fixtures.push(unit.fixtures);
      const hash = this.hashOf(unit);
      if (hash === null) continue;
      const hashes = byFile.get(unit.module.relativeFilePath);
      if (hashes) hashes.push(hash);
      else byFile.set(unit.module.relativeFilePath, [hash]);
    }
    // Sorted by hash, so that moving code around in a file doesn't change it; each part keeps its own order.
    for (const hashes of byFile.values()) hashes.sort();
    return { units, byFile, places, fixtures };
  }

  /**
   * Everything a test's roots reach on top of `base`, the code its file runs when loaded, which all its tests share,
   * with the fixtures it needs of each test object reached: the hash, the files, and whether all of it could be
   * followed.
   */
  dependencies(roots: Unit[], base: Reach, needs: FixtureNeeds, report: (place: Place) => void): Dependencies {
    const reached = [base, this.reach(roots, [base])];
    // A fixture can ask for one an object it extends defines, or use another test object, so names and objects are
    // shared and followed until nothing new turns up.
    const names = new Set(needs.names);
    let all = needs.all;
    const taken = new Set<Unit>();
    for (let grew = true; grew;) {
      grew = false;
      const fixtures = new Set(reached.flatMap((item) => item.fixtures));
      const fresh: Unit[] = [];
      for (const item of fixtures) {
        for (const name of item.auto) names.add(name);
      }
      for (const item of fixtures) {
        for (const name of all ? item.byName.keys() : [...names]) {
          for (const fixture of item.byName.get(name) ?? []) {
            if (!taken.has(fixture.unit)) fresh.push(fixture.unit);
            taken.add(fixture.unit);
            if (fixture.uses === null) {
              grew ||= !all;
              all = true;
            }
            for (const used of fixture.uses ?? []) {
              grew ||= !names.has(used);
              names.add(used);
            }
          }
        }
      }
      if (fresh.length > 0) {
        reached.push(this.reach(fresh, reached));
        grew = true;
      }
    }
    const places = reached.flatMap((item) => item.places);
    const start = (place: Place) => (place.problem.node as Span).start;
    // Compared by code unit, as `files` is, so that the order doesn't depend on the locale.
    const path = (a: Place, b: Place) =>
      a.relativeFilePath < b.relativeFilePath ? -1 : a.relativeFilePath > b.relativeFilePath ? 1 : 0;
    places.sort((a, b) => path(a, b) || start(a) - start(b));
    for (const place of places) {
      const key = `${place.relativeFilePath}\0${start(place)}\0${place.problem.message}`;
      if (place.isQuiet || this.reported.has(key)) continue;
      this.reported.add(key);
      report(place);
    }
    const files = [...new Set(reached.flatMap((item) => [...item.byFile.keys()]))].sort();
    const parts = files.map((file) => {
      return [file, reached.flatMap((item) => item.byFile.get(file) ?? []).sort()];
    });
    return { hash: shortHash(JSON.stringify(parts)), files, isComplete: places.length === 0 };
  }

  private newModule(
    relativeFilePath: string,
    parsed: ParsedFile | null,
    text: string | null,
    values: Values,
    readModule: ModuleReader | null,
  ): Module {
    return {
      relativeFilePath,
      parsed,
      text,
      values,
      readModule,
      load: [null, null],
      whole: [null, null],
      imports: new Map(),
      reads: new Map(),
    };
  }

  private newUnit(module: Module, roots: Root[], cut: ReadonlyMap<number, number>, types: boolean): Unit {
    return {
      module,
      roots,
      cut,
      types,
      with: [],
      edges: null,
      place: null,
      fixtures: null,
      prepare: null,
      hash: undefined,
    };
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
        module =
          this.modules.get(parsed) ??
          this.newModule(source.relativeFilePath, parsed, null, new Values(), source.readModule);
        this.modules.set(parsed, module);
      } else {
        module = this.newModule(source.relativeFilePath, null, source.code.replace(/\r\n?/g, '\n'), new Values(), null);
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
    module.whole = [unit, unit];
    module.load = [unit, unit];
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

  /** The unit of a declaration: a declarator, function, class, enum, namespace or `import x = require()`. */
  private declarationUnit(module: Module, declaration: Node, types: boolean, roots?: Node[]): Unit {
    const cache = this.units[Number(types)];
    // A function's parameters alone are a unit of their own, kept apart from the whole function.
    const key = roots ?? declaration;
    let unit = cache.get(key);
    if (!unit) {
      const program = (module.parsed as ParsedFile).program;
      const scopes = scopesAt(program, declaration);
      const nodes = roots ?? [declaration];
      const inner = roots ? [...scopes, declaration] : scopes;
      unit = this.newUnit(
        module,
        nodes.map((node) => ({ node, scopes: inner })),
        new Map(),
        types,
      );
      // Code in a module runs only once the module is loaded, which runs its top-level code.
      unit.with.push(this.loadUnit(module, types));
      cache.set(key, unit);
    }
    return unit;
  }

  /** A place in a module the scan can't follow, as a unit that marks the tests that reach it. */
  private placeUnit(module: Module, at: Span, message: string, isQuiet = false): Unit {
    const parsed = module.parsed as ParsedFile;
    const unit = this.newUnit(module, [], new Map(), false);
    unit.edges = new Set();
    unit.place = {
      relativeFilePath: module.relativeFilePath,
      source: parsed.source,
      problem: problem('dependency-not-followed', at, message, snippet(parsed.source.slice(at.start, at.end))),
      isQuiet,
    };
    return unit;
  }

  /**
   * What a module's import of `name` from `specifier` stands for, `at` being the statement in `from` that imports it:
   * the declaration it exports, `*` for all of it, or `''` for the code it runs when loaded. Installed packages give
   * nothing; a local module that can't be read gives a place.
   */
  private imported(from: Module, specifier: string, name: string, types: boolean, at: Span): Unit[] {
    const key = `${Number(types)}\0${specifier}\0${name}\0${at.start}`;
    let units = from.imports.get(key);
    if (!units) {
      from.imports.set(key, IN_PROGRESS);
      units = this.readImport(from, specifier, name, types, at);
      // Within a cycle, the answer depends on where the search started, so it isn't kept.
      if (units === IN_PROGRESS) from.imports.delete(key);
      else from.imports.set(key, units);
    }
    return units;
  }

  /** The module a specifier names, from where `from` is; null when no module is read, as for one file's code. */
  private read(from: Module, specifier: string): ReturnType<ModuleReader> | null {
    if (!from.readModule) return null;
    let read = from.reads.get(specifier);
    if (!read) {
      // A query, as in Vite's `./script.ts?raw`, says how to load the file, not which file.
      read = from.readModule(specifier.replace(/\?.*$/s, ''));
      from.reads.set(specifier, read);
    }
    return read;
  }

  private readImport(from: Module, specifier: string, name: string, types: boolean, at: Span): Unit[] {
    const read = this.read(from, specifier);
    if (read === null) {
      return isLocalSpecifier(specifier) ? [this.placeUnit(from, at, `'${specifier}' is not read.`, true)] : [];
    }
    if ('reason' in read) {
      if (PACKAGE_REASONS.has(read.reason)) return [];
      return [this.placeUnit(from, at, `'${specifier}' ${read.reason}, so dependencyHash doesn't cover it.`)];
    }
    const module = this.moduleOf(read);
    if (module.parsed === null) return [this.textUnit(module)];
    if (DECLARATION_FILE.test(module.relativeFilePath) && !types) {
      // An import only types use is dropped when the code is compiled; a value the test uses runs code from elsewhere.
      if (name === '') return [];
      return [
        this.placeUnit(
          from,
          at,
          `'${specifier}' leads to a declaration file, so dependencyHash doesn't cover the code that runs.`,
        ),
      ];
    }
    if (module.parsed.error) {
      return [this.placeUnit(from, at, `'${specifier}' could not be parsed, so dependencyHash doesn't cover it.`)];
    }
    return name === '' ? [this.loadUnit(module, types)] : this.exported(module, name, types, new Set());
  }

  /**
   * The units of what a module exports under a name: its own export first, then one an `export *` passes on, as the
   * module system picks them. `*` is the whole module. A name the scan can't find, as with CommonJS exports, also
   * takes the whole module, so that nothing it may run is left out.
   */
  private exported(module: Module, name: string, types: boolean, searched: Set<Module>): Unit[] {
    if (name === '*' || searched.has(module)) return [this.wholeUnit(module, types)];
    searched.add(module);
    const program = (module.parsed as ParsedFile).program;
    const local = (localName: string): Unit[] => {
      const declaration =
        module.values.declarationOf(localName, [program]) ?? otherDeclaration(localName, [program], types);
      // A global the module re-exports, such as `structuredClone`, has no code in the project.
      if (declaration === null) return [];
      return this.toDeclaration(module, declaration, localName, null, types);
    };
    for (const statement of program.body) {
      if (statement.type === 'ExportDefaultDeclaration' && name === 'default') {
        const declaration = statement.declaration;
        return declaration.type === 'Identifier'
          ? local(declaration.name)
          : [this.declarationUnit(module, declaration, types)];
      }
      if (statement.type === 'ExportAllDeclaration' && statement.exported && exportName(statement.exported) === name) {
        return this.imported(module, statement.source.value, '*', types, statement);
      }
      if (statement.type !== 'ExportNamedDeclaration') continue;
      if (statement.exportKind === 'type' && !types) continue;
      const declaration = statement.declaration;
      if (declaration) {
        if (declaration.type === 'VariableDeclaration') {
          const declarator = declaration.declarations.find((item) => bindingNames(item.id).includes(name));
          if (declarator) return this.toDeclaration(module, declarator, name, null, types);
        } else if ('id' in declaration && declaration.id?.type === 'Identifier' && declaration.id.name === name) {
          // `export import Fees = require('./fees')` stands for the other module.
          return this.toDeclaration(module, declaration, name, null, types);
        }
        continue;
      }
      const specifier = statement.specifiers.find((item) => exportName(item.exported) === name);
      if (!specifier) continue;
      const localName = exportName(specifier.local);
      return statement.source
        ? this.imported(module, statement.source.value, localName, types, statement)
        : local(localName);
    }
    // `export *` passes on every name but `default`, and only when the module doesn't export the name itself.
    if (name !== 'default') {
      for (const statement of program.body) {
        if (statement.type !== 'ExportAllDeclaration' || statement.exported) continue;
        const found = this.reexported(module, statement.source.value, name, types, searched);
        if (found) return found;
      }
    }
    return [this.wholeUnit(module, types)];
  }

  /** What `export * from source` gives for a name; null when the module behind it doesn't export it. */
  private reexported(from: Module, source: string, name: string, types: boolean, searched: Set<Module>): Unit[] | null {
    const read = this.read(from, source);
    if (!read || 'reason' in read) return null;
    const module = this.moduleOf(read);
    if (module.parsed === null || module.parsed.error) return null;
    const found = this.exported(module, name, types, searched);
    // A module that doesn't export the name falls back to the whole of it, which doesn't count as found here.
    const isWhole = found.length === 1 && found[0] === module.whole[Number(types)];
    return isWhole || found === IN_PROGRESS ? null : found;
  }

  /**
   * The units a name stands for where it is declared: the declaration, the export of the module it's imported from, or
   * for a parameter only the parameters, as the call that passes their values is followed on its own.
   */
  private toDeclaration(
    module: Module,
    declaration: Node,
    name: string,
    member: string | null,
    types: boolean,
  ): Unit[] {
    switch (declaration.type) {
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier': {
        const statement = this.importOf(module, declaration);
        const imported =
          declaration.type === 'ImportSpecifier'
            ? exportName(declaration.imported)
            : declaration.type === 'ImportDefaultSpecifier'
              ? 'default'
              : (member ?? '*');
        return this.imported(module, statement.source.value, imported, types, statement);
      }
      case 'TSImportEqualsDeclaration': {
        const reference = declaration.moduleReference;
        if (reference.type !== 'TSExternalModuleReference') return [this.declarationUnit(module, declaration, types)];
        return this.imported(module, reference.expression.value, member ?? '*', types, declaration);
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (declaration.params.some((parameter) => bindingNames(parameter).includes(name))) {
          return [this.declarationUnit(module, declaration, types, declaration.params)];
        }
        break;
      case 'VariableDeclarator': {
        const testObject = this.testObjectUnit(module, declaration, types);
        if (testObject) return [testObject];
        break;
      }
    }
    return [this.declarationUnit(module, declaration, types)];
  }

  /**
   * A test object built with `extend()` on the framework's own: its code without the fixtures its `extend()` calls
   * define, which each test takes as it needs them. Null for any other value.
   */
  private testObjectUnit(module: Module, declarator: VariableDeclarator, types: boolean): Unit | null {
    const cache = this.testObjects[Number(types)];
    if (!cache.has(declarator)) {
      // A test object built on itself, through imports, isn't one.
      cache.set(declarator, null);
      cache.set(declarator, this.readTestObject(module, declarator, types));
    }
    return cache.get(declarator) ?? null;
  }

  private readTestObject(module: Module, declarator: VariableDeclarator, types: boolean): Unit | null {
    const scopes = scopesAt((module.parsed as ParsedFile).program, declarator);
    const calls: CallExpression[] = [];
    let node = declarator.init && unwrap(declarator.init);
    while (node?.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed) {
      if (node.callee.property.name !== 'extend') break;
      calls.push(node);
      node = unwrap(node.callee.object);
    }
    if (!node || calls.length === 0 || !this.isFrameworkTest(module, node, scopes, types)) return null;
    const byName = new Map<string, Fixture[]>();
    const auto: string[] = [];
    const cut: Span[] = [];
    const define = (name: string, unit: Unit, value: Node | undefined, options: Node | undefined) => {
      byName.set(name, [...(byName.get(name) ?? []), { unit, uses: this.fixtureUses(module, value, scopes, types) }]);
      if (options?.type === 'ObjectExpression' && options.properties.some(isAutoOption)) auto.push(name);
    };
    for (const call of calls) {
      const [first] = call.arguments;
      if (first.type === 'Literal' && typeof first.value === 'string') {
        // Vitest's `test.extend('name', options?, fn)`.
        cut.push(...call.arguments);
        const unit = this.declarationUnit(module, call, types, call.arguments);
        define(first.value, unit, call.arguments.at(-1), call.arguments.length > 2 ? call.arguments[1] : undefined);
      } else if (first.type === 'ObjectExpression' && first.properties.every(isNamedProperty)) {
        cut.push(first);
        for (const property of first.properties as ObjectProperty[]) {
          const value = unwrap(property.value);
          const [fn, options] = value.type === 'ArrayExpression' ? value.elements : [value];
          define(
            propertyKey(property) as string,
            this.declarationUnit(module, property, types),
            fn ?? undefined,
            options ?? undefined,
          );
        }
      }
    }
    if (cut.length === 0) return null;
    const unit = this.newUnit(
      module,
      [{ node: declarator, scopes }],
      new Map(cut.map((span) => [span.start, span.end])),
      types,
    );
    unit.with.push(this.loadUnit(module, types));
    unit.fixtures = { byName, auto };
    return unit;
  }

  /**
   * Whether an expression is a test object of the framework: its own `test`, `mergeTests()` of test objects, or one
   * built on them with `extend()`, followed through imports.
   */
  private isFrameworkTest(module: Module, expression: Node, scopes: readonly Node[], types: boolean): boolean {
    const node = unwrap(expression as Expression);
    if (node.type === 'CallExpression') {
      const { callee } = node;
      if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'extend') {
        return this.isFrameworkTest(module, callee.object, scopes, types);
      }
      // `mergeTests(a, b)`.
      return this.isFrameworkTest(module, callee, scopes, types);
    }
    if (node.type !== 'Identifier') return false;
    const declaration = module.values.declarationOf(node.name, scopes);
    if (declaration === null) return false;
    if (declaration.type === 'ImportSpecifier' || declaration.type === 'ImportDefaultSpecifier') {
      if (FRAMEWORK.test(this.importOf(module, declaration).source.value)) return true;
    }
    return this.toDeclaration(module, declaration, node.name, null, types).some((unit) => {
      if (unit.fixtures) return true;
      const root = unit.roots.at(0)?.node;
      return (
        root?.type === 'VariableDeclarator' &&
        root.init !== null &&
        this.isFrameworkTest(
          unit.module,
          root.init,
          root === declaration ? scopes : scopesAt((unit.module.parsed as ParsedFile).program, root),
          types,
        )
      );
    });
  }

  /** The fixtures a fixture's function asks for; null when it takes them whole, or isn't a function the scan finds. */
  private fixtureUses(
    module: Module,
    value: Node | undefined,
    scopes: readonly Node[],
    types: boolean,
  ): string[] | null {
    if (!value) return [];
    const node = unwrap(value as Expression);
    if (isFunctionNode(node)) return takesWhole(node, 0) ? null : destructuredNames(node, 0);
    if (node.type !== 'Identifier') return [];
    const declaration = module.values.declarationOf(node.name, scopes);
    if (declaration === null) return null;
    for (const unit of this.toDeclaration(module, declaration, node.name, null, types)) {
      const root = unit.roots.at(0)?.node;
      const fn = root?.type === 'VariableDeclarator' ? root.init && unwrap(root.init) : root;
      if (fn?.type === 'FunctionDeclaration' || isFunctionNode(fn))
        return takesWhole(fn, 0) ? null : destructuredNames(fn, 0);
      // A value fixture, such as a constant, asks for nothing.
      if (root?.type === 'VariableDeclarator') return [];
    }
    return null;
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
    const { module, types } = unit;
    const program = (module.parsed as ParsedFile).program;
    const isOwn = (declaration: Node) => unit.roots.some((root) => contains(root.node, declaration));
    const add = (units: Unit[]) => {
      for (const target of units) edges.add(target);
    };
    const follow = (name: string, scopes: readonly Node[], member: string | null) => {
      const declaration = module.values.declarationOf(name, scopes) ?? otherDeclaration(name, scopes, types);
      if (declaration === null || isOwn(declaration)) return;
      add(this.toDeclaration(module, declaration, name, member, types));
    };
    /** A module loaded by the path in `argument`, or a place when the path is worked out at run time. */
    const loadsByPath = (argument: Node | undefined, at: Span) => {
      // `vi.mock(import('./broker'))`: the walk reads the import() itself.
      if (argument?.type === 'ImportExpression') return;
      if (argument?.type === 'Literal' && typeof argument.value === 'string') {
        add(this.imported(module, argument.value, '*', types, at));
      } else {
        edges.add(this.placeUnit(module, at, COMPUTED));
      }
    };
    const walk = (node: Node, scopes: Node[], key: string | null, parent: Node | null): void => {
      if (unit.cut.get(node.start) === node.end) return;
      switch (node.type) {
        case 'Identifier':
          if (isReference(key, parent)) follow(node.name, scopes, null);
          break;
        case 'JSXIdentifier':
          // `<div>` is an element; `<OrderTicket>` a component.
          if (key === 'name' && parent?.type !== 'JSXAttribute' && /^[A-Z_$]/.test(node.name)) {
            follow(node.name, scopes, null);
          }
          return;
        case 'MemberExpression':
        case 'JSXMemberExpression': {
          // `pages.OrderTicket` on a namespace import needs only that export.
          const { object, property } = node;
          const named = node.type === 'JSXMemberExpression' || !node.computed;
          if (named && (object.type === 'Identifier' || object.type === 'JSXIdentifier')) {
            // A property that isn't computed is a name.
            follow(object.name, scopes, (property as { name: string }).name);
            return;
          }
          break;
        }
        case 'ImportExpression':
          loadsByPath(node.source, node);
          break;
        case 'CallExpression': {
          const { callee } = node;
          if (callee.type === 'Identifier' && callee.name === 'require') loadsByPath(node.arguments.at(0), node);
          if (callee.type === 'MemberExpression' && !callee.computed) {
            const { object, property } = callee;
            if (object.type === 'Identifier' && object.name === 'vi' && VI_MODULE_CALLS.has(property.name)) {
              loadsByPath(node.arguments.at(0), node);
            }
            if (object.type === 'MetaProperty' && property.name.startsWith('glob')) {
              edges.add(
                this.placeUnit(
                  module,
                  node,
                  "The modules this loads match a pattern, so dependencyHash doesn't cover them.",
                ),
              );
            }
          }
          break;
        }
        case 'ImportDeclaration':
          if (node.importKind !== 'type' || types) add(this.imported(module, node.source.value, '', types, node));
          return;
        case 'TSImportEqualsDeclaration':
          if (node.moduleReference.type !== 'TSExternalModuleReference') break;
          if (node.importKind !== 'type' || types) {
            add(this.imported(module, node.moduleReference.expression.value, '', types, node));
          }
          return;
        // Re-exports, in a module taken whole: each name comes from the other module.
        case 'ExportNamedDeclaration':
          if (!node.source) break;
          if (node.exportKind !== 'type' || types) {
            for (const specifier of node.specifiers) {
              add(this.imported(module, node.source.value, exportName(specifier.local), types, node));
            }
          }
          return;
        case 'ExportAllDeclaration':
          if (node.exportKind !== 'type' || types) add(this.imported(module, node.source.value, '*', types, node));
          return;
      }
      const isScope = isScopeNode(node);
      if (isScope) scopes.push(node);
      const fields = node as unknown as Record<string, unknown>;
      for (const field of visitorKeys[node.type]) {
        if (!types && TYPE_KEYS.has(field)) continue;
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
    if (unit === module.load[Number(types)]) {
      for (const statement of program.body) {
        if (statement.type === 'ImportDeclaration' || statement.type === 'TSImportEqualsDeclaration') {
          walk(statement, [program], null, null);
        }
        if (
          (statement.type === 'ExportAllDeclaration' || statement.type === 'ExportNamedDeclaration') &&
          statement.source &&
          (statement.exportKind !== 'type' || types)
        ) {
          add(this.imported(module, statement.source.value, '', types, statement));
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
    case 'TSImportEqualsDeclaration':
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
 * A namespace or `import x = require()` a name refers to, or for a type test also an interface or type alias, looked
 * up in the scopes around it. Imports, classes and enums are bindings `Values` already finds.
 */
function otherDeclaration(name: string, scopes: readonly Node[], types: boolean): Node | null {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    const body =
      scope.type === 'Program' || scope.type === 'BlockStatement' || scope.type === 'TSModuleBlock' ? scope.body : [];
    for (const statement of body) {
      const node = declared(statement);
      const isNamed = 'id' in node && node.id?.type === 'Identifier' && node.id.name === name;
      const isValue = node.type === 'TSModuleDeclaration' || node.type === 'TSImportEqualsDeclaration';
      if (isNamed && (isValue || (types && TYPES.has(node.type)))) return node;
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
      units = [
        graph.unit(
          moduleOf(suite.frame),
          [suite.call, ...bodyNodes(fn).filter(isLoadCode)],
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
  // What the file runs when it loads is the same for each of its tests, and often most of what they run.
  const base = graph.reach([load]);
  return (test) => {
    const roots = [graph.unit(moduleOf(test.frame), [test.call], [], types), ...registering(test.registeredBy)];
    for (let scope: Scope | null = test.scope; scope; scope = scope.parent) {
      if (scope.suite) roots.push(...suiteUnit(scope.suite));
    }
    const needs: FixtureNeeds = { names: [...test.declaration.fixtures], all: test.declaration.takesAllFixtures };
    for (let scope: Scope | null = test.scope; scope; scope = scope.parent) {
      needs.names.push(...scope.setupFixtures);
      needs.all ||= scope.takesAllFixtures;
    }
    return graph.dependencies(roots, base, needs, report);
  };
}
