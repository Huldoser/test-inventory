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
import type { ConfigGap, RunsWith } from './config-dependencies.ts';
import type { Extraction, Frame, PendingSuite, PendingTest, Scope } from './extract.ts';
import { exportName, parseModule } from './frameworks/bindings.ts';
import { destructuredNames, problem, takesWhole } from './frameworks/common.ts';
import { shortHash, hashNodes } from './hash.ts';
import type { ModuleReader, ModuleSource, Problem, Span } from './model.ts';
import type { ParsedFile } from './parse.ts';
import { snippet, type SourceText } from './source.ts';
import type { Framework } from './types.ts';
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
  /**
   * Fixtures the functions in its code ask for when passed to a hook, a condition such as `test.skip()`, `test.use()`
   * or a test, as a helper that registers a hook does; null when one takes them whole or can't be told.
   */
  asks: string[] | null;
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
  /** The fixtures the units' code asks for; null when some of it asks for all. */
  asks: string[] | null;
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
  framework: Framework;
}

/** An expression's value where it is written: the node, and the module and scopes to read it in. */
interface Value {
  module: Module;
  node: Node;
  scopes: readonly Node[];
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

/** The nodes an import binds a name with. */
const IMPORT_BINDINGS = new Set([
  'ImportSpecifier',
  'ImportDefaultSpecifier',
  'ImportNamespaceSpecifier',
  'TSImportEqualsDeclaration',
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

/** Calls on a test object whose functions run with the test's fixtures: tests and hooks. */
const FIXTURE_CALLS = new Set([
  ...['test', 'it', 'only', 'todo', 'concurrent', 'sequential'],
  ...['beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'aroundEach', 'aroundAll'],
]);

/** Conditions, which take a value or a function of the fixtures, as in `test.skip(({ account }) => ...)`. */
const CONDITION_CALLS = new Set(['skip', 'fixme', 'fail', 'slow']);

/** Vitest's globals, which a file with `globals: true` calls without importing them. */
const GLOBAL_TESTS = new Set([
  ...['test', 'it', 'describe', 'suite', 'bench'],
  ...['beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'aroundEach', 'aroundAll'],
]);

/** Calls that set fixtures for a file or a describe: Playwright's `test.use()`, Vitest's `override()` and `scoped()`. */
const USE_CALLS = new Set(['use', 'override', 'scoped']);

/** The exports of a framework module that are test objects, or combine them. */
const TEST_EXPORTS = new Set(['test', 'it', 'mergeTests']);

/** How many constants and imports deep a fixture's value is followed. */
const MAX_VALUE_DEPTH = 16;

/** Playwright's own fixtures and options (1.64), which a fixtures file can override for every test. */
const BUILT_INS = new Set([
  ...['browser', 'browserName', 'channel', 'connectOptions', 'context', 'defaultBrowserType', 'headless'],
  ...['launchOptions', 'mount', 'page', 'playwright', 'request', 'reuseContext', 'router', 'screenshot', 'trace'],
  'video',
  ...['acceptDownloads', 'actionTimeout', 'baseURL', 'bypassCSP', 'clientCertificates', 'colorScheme'],
  ...['contextOptions', 'contrast', 'deviceScaleFactor', 'extraHTTPHeaders', 'forcedColors', 'geolocation'],
  ...['hasTouch', 'httpCredentials', 'ignoreHTTPSErrors', 'isMobile', 'javaScriptEnabled', 'locale'],
  ...['navigationTimeout', 'offline', 'permissions', 'proxy', 'reducedMotion', 'screen', 'serviceWorkers'],
  ...['storageState', 'testIdAttribute', 'timezoneId', 'userAgent', 'viewport'],
]);

/**
 * Whether an expression is a value that can't be a function, such as a literal, an object or an array: a fixture with
 * such a value is never called, so it asks for no other fixture.
 */
function isPlainValue(node: Node): boolean {
  return PLAIN_VALUES.has(node.type);
}

const PLAIN_VALUES = new Set([
  'Literal',
  'TemplateLiteral',
  'ArrayExpression',
  'ObjectExpression',
  'UnaryExpression',
  'BinaryExpression',
]);

/** Whether a declarator at the top of a module, as an exported one is, is a `const`. */
function isConst(module: Module, declarator: Node): boolean {
  return (module.parsed as ParsedFile).program.body.some((statement) => {
    const declaration = declared(statement);
    return (
      declaration.type === 'VariableDeclaration' &&
      declaration.kind === 'const' &&
      declaration.declarations.includes(declarator as VariableDeclarator)
    );
  });
}

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

/**
 * Whether a top-level or describe statement runs when the file or describe does. An import that names nothing is there
 * for what its module does when loaded, so it is code of the file, also for a package.
 */
function isLoadCode(statement: Node): boolean {
  // `import '@testing-library/jest-dom'` runs a module for what it does; a named import is followed through its names.
  if (statement.type === 'ImportDeclaration')
    return statement.importKind !== 'type' && statement.specifiers.length === 0;
  return !DECLARATIONS.has(statement.type) || runsOnLoad(statement);
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
    let asks: string[] | null = [];
    for (const unit of units) {
      if (unit.place) places.push(unit.place);
      if (unit.fixtures) fixtures.push(unit.fixtures);
      if (unit.asks === null) asks = null;
      else if (asks !== null && unit.asks.length > 0) asks.push(...unit.asks);
      const hash = this.hashOf(unit);
      if (hash === null) continue;
      const hashes = byFile.get(unit.module.relativeFilePath);
      if (hashes) hashes.push(hash);
      else byFile.set(unit.module.relativeFilePath, [hash]);
    }
    // Sorted by hash, so that moving code around in a file doesn't change it; each part keeps its own order.
    for (const hashes of byFile.values()) hashes.sort();
    return { units, byFile, places, fixtures, asks };
  }

  /**
   * Everything a test's roots reach on top of `base`, the code its file runs when loaded, which all its tests share,
   * with the fixtures it needs of each test object reached: the hash, the files, and whether all of it could be
   * followed.
   */
  dependencies(roots: Unit[], base: Reach, needs: FixtureNeeds, report: (place: Place) => void): Dependencies {
    const reached = [base, this.reach(roots, [base])];
    // A fixture can ask for one an object it extends defines, or use another test object, so names are shared by
    // every test object reached, and each name and object is read once.
    const names = new Set<string>();
    const queue: string[] = [];
    const objects: Fixtures[] = [];
    const taken = new Set<Unit>();
    let fresh: Unit[] = [];
    let all = false;
    const need = (name: string) => {
      if (names.has(name)) return;
      names.add(name);
      queue.push(name);
    };
    const takeAll = () => {
      all = true;
      for (const item of objects) for (const name of item.byName.keys()) need(name);
    };
    const resolve = (item: Fixtures, name: string) => {
      for (const fixture of item.byName.get(name) ?? []) {
        if (taken.has(fixture.unit)) continue;
        taken.add(fixture.unit);
        fresh.push(fixture.unit);
        if (fixture.uses === null) {
          if (!all) takeAll();
        } else {
          for (const used of fixture.uses) need(used);
        }
      }
    };
    const found = (reach: Reach) => {
      if (reach.asks === null && !all) takeAll();
      for (const name of reach.asks ?? []) need(name);
      // Each walk skips what earlier ones reached, so an object turns up once.
      for (const item of reach.fixtures) {
        objects.push(item);
        for (const name of all ? item.byName.keys() : item.auto) need(name);
        for (const name of names) resolve(item, name);
      }
    };
    for (const name of needs.names) need(name);
    for (const reach of reached) found(reach);
    if (needs.all) takeAll();
    while (queue.length > 0 || fresh.length > 0) {
      for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
        for (const item of objects) resolve(item, name);
      }
      if (fresh.length > 0) {
        const reach = this.reach(fresh, reached);
        fresh = [];
        reached.push(reach);
        found(reach);
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
      asks: [],
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
    const { source } = module.parsed as ParsedFile;
    const unit = this.newUnit(module, [], new Map(), false);
    unit.edges = new Set();
    const text = snippet(source.slice(at.start, at.end)) || null;
    unit.place = {
      relativeFilePath: module.relativeFilePath,
      source,
      problem: problem('dependency-not-followed', at, message, text),
      isQuiet,
    };
    return unit;
  }

  /**
   * A module the config runs each test with, taken whole: the config itself, a setup file, or a file of a setup
   * project.
   */
  runUnit(source: ModuleSource, isConfig: boolean): Unit {
    const module = this.moduleOf(source);
    if (module.parsed === null) return this.textUnit(module);
    const { error } = module.parsed;
    if (error) {
      // A config that doesn't parse is reported when the scan reads it.
      const message = "The file could not be parsed, so dependencyHash doesn't cover it.";
      return this.placeUnit(module, error, message, isConfig);
    }
    return this.wholeUnit(module, false);
  }

  /** Something in a config the scan can't follow, as a unit that marks the tests whose config it is. */
  gapUnit(gap: ConfigGap): Unit {
    if ('module' in gap) {
      const module = this.moduleOf(gap.module);
      // The path a setup key names, where the config writes it.
      const at = gap.text === null ? null : literalIn((module.parsed as ParsedFile).program, gap.text);
      return this.placeUnit(module, at ?? { start: 0, end: 0 }, gap.message, gap.isQuiet);
    }
    const module = this.newModule(gap.relativeFilePath, null, null, new Values(), null);
    const unit = this.newUnit(module, [], new Map(), false);
    unit.edges = new Set();
    const text = snippet(gap.source.slice(gap.span.start, gap.span.end));
    unit.place = {
      relativeFilePath: gap.relativeFilePath,
      source: gap.source,
      problem: problem('dependency-not-followed', gap.span, gap.message, text),
      isQuiet: gap.isQuiet,
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
    const framework = node && calls.length > 0 ? this.frameworkOf(module, node, scopes, types) : null;
    if (!framework) return null;
    const byName = new Map<string, Fixture[]>();
    const auto: string[] = [];
    const cut: Span[] = [];
    const define = (
      name: string,
      unit: Unit,
      value: Node | undefined,
      options: Node | undefined,
      where: Value = { module, node: declarator, scopes },
    ) => {
      const uses = this.fixtureUses(where.module, value, where.scopes, types);
      byName.set(name, [...(byName.get(name) ?? []), { unit, uses }]);
      const read = options && this.valueOf(where.module, options, where.scopes, types).node;
      // Playwright's own fixtures and options, such as `page` or `storageState`, shape what every test runs.
      const isBuiltIn = framework === 'playwright' && BUILT_INS.has(name);
      if (isBuiltIn || (read?.type === 'ObjectExpression' && read.properties.some(isAutoOption))) {
        auto.push(name);
      }
    };
    for (const call of calls) {
      const first = call.arguments.at(0);
      if (first === undefined) continue;
      if (first.type === 'Literal' && typeof first.value === 'string') {
        // Vitest's `test.extend('name', options?, fn)`.
        cut.push(...call.arguments);
        const unit = this.declarationUnit(module, call, types, call.arguments);
        define(first.value, unit, call.arguments.at(-1), call.arguments.length > 2 ? call.arguments[1] : undefined);
      } else if (first.type === 'ObjectExpression' && first.properties.every(isNamedProperty)) {
        cut.push(first);
        for (const property of first.properties as ObjectProperty[]) {
          // `[fn, { auto: true }]`, also when a constant holds the pair or the options.
          const value = this.valueOf(module, property.value, scopes, types);
          const [fn, options] = value.node.type === 'ArrayExpression' ? value.node.elements : [value.node];
          const unit = this.declarationUnit(module, property, types);
          define(propertyKey(property) as string, unit, fn ?? undefined, options ?? undefined, value);
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
    unit.fixtures = { byName, auto, framework };
    return unit;
  }

  /**
   * The framework of a test object: its own `test`, `mergeTests()` of test objects, or one built on them with
   * `extend()`, followed through imports; null for an expression that isn't one.
   */
  private frameworkOf(module: Module, expression: Node, scopes: readonly Node[], types: boolean): Framework | null {
    const node = unwrap(expression as Expression);
    if (node.type === 'CallExpression') {
      const { callee } = node;
      if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'extend') {
        return this.frameworkOf(module, callee.object, scopes, types);
      }
      // `mergeTests(a, b)`.
      return this.frameworkOf(module, callee, scopes, types);
    }
    if (node.type !== 'Identifier') return null;
    const declaration = module.values.declarationOf(node.name, scopes);
    if (declaration === null) return null;
    if (declaration.type === 'ImportSpecifier') {
      const source = this.importOf(module, declaration).source.value;
      // `expect` has an extend() too, for matchers.
      if (FRAMEWORK.test(source)) {
        return TEST_EXPORTS.has(exportName(declaration.imported))
          ? source === 'vitest'
            ? 'vitest'
            : 'playwright'
          : null;
      }
    }
    for (const unit of this.toDeclaration(module, declaration, node.name, null, types)) {
      if (unit.fixtures) return unit.fixtures.framework;
      const root = unit.roots.at(0)?.node;
      if (root?.type !== 'VariableDeclarator' || root.init === null) continue;
      const at = root === declaration ? scopes : scopesAt((unit.module.parsed as ParsedFile).program, root);
      const framework = this.frameworkOf(unit.module, root.init, at, types);
      if (framework) return framework;
    }
    return null;
  }

  /**
   * Takes what the values given to `test.use()`, `override()` or `scoped()` ask for: functions and `[fn, options]`
   * pairs, as `extend()` takes them. Playwright's options and a spread of its `devices` are values, not fixtures.
   */
  private useValues(values: Extract<Node, { type: 'ObjectExpression' }>, take: (value: Node) => void): void {
    for (const property of values.properties) {
      if (property.type === 'SpreadElement') {
        const argument = unwrap(property.argument);
        const isDevice =
          argument.type === 'MemberExpression' &&
          argument.object.type === 'Identifier' &&
          argument.object.name === 'devices';
        if (!isDevice) take(property);
        continue;
      }
      const value = unwrap(property.value);
      const fn = value.type === 'ArrayExpression' ? value.elements.at(0) : value;
      const isOption = BUILT_INS.has(propertyKey(property) as string);
      if (fn && (isFunctionNode(fn) || !isOption)) take(fn);
    }
  }

  /**
   * Whether a call is on a test object, so that its functions run with fixtures: the framework's own, a global one,
   * one built with `extend()`, or a parameter, as a helper that takes the test object has.
   */
  private isTestReference(module: Module, callee: Node, scopes: readonly Node[], types: boolean): boolean {
    let root = callee;
    while (root.type === 'MemberExpression' || root.type === 'CallExpression') {
      root = root.type === 'MemberExpression' ? root.object : root.callee;
    }
    if (root.type !== 'Identifier') return false;
    const declaration = module.values.declarationOf(root.name, scopes);
    if (declaration === null) return GLOBAL_TESTS.has(root.name);
    if (declaration.type === 'ImportSpecifier') {
      if (FRAMEWORK.test(this.importOf(module, declaration).source.value)) return true;
    }
    // A parameter's binding is the function it belongs to.
    if (declaration.type === 'FunctionDeclaration' || isFunctionNode(declaration)) {
      return declaration.params.some((parameter) => bindingNames(parameter).includes(root.name));
    }
    return this.frameworkOf(module, root, scopes, types) !== null;
  }

  /**
   * The fixtures a fixture's or hook's function asks for. A value such as a constant asks for none; null when the
   * function takes them whole, or the value can't be told, as a factory's result or a fixture from a package.
   */
  private fixtureUses(
    module: Module,
    value: Node | undefined,
    scopes: readonly Node[],
    types: boolean,
  ): string[] | null {
    if (!value) return [];
    const { node } = this.valueOf(module, value, scopes, types);
    if (node.type === 'FunctionDeclaration' || isFunctionNode(node)) {
      return takesWhole(node, 0) ? null : destructuredNames(node, 0);
    }
    return isPlainValue(node) ? [] : null;
  }

  /**
   * What an expression holds, followed through constants and imports to the function or value they are bound to; the
   * expression itself when it is something else, with the module and scopes to read it in.
   */
  private valueOf(module: Module, value: Node, scopes: readonly Node[], types: boolean, depth = 0): Value {
    const node = unwrap(value as Expression);
    if (node.type !== 'Identifier' || depth > MAX_VALUE_DEPTH) return { module, node, scopes };
    // Only a `const` holds one value; a `let` may be given another later.
    const constant = module.values.constantOf(node.name, scopes);
    if (constant) return this.valueOf(module, constant.init, constant.scopes, types, depth + 1);
    const declaration = module.values.declarationOf(node.name, scopes);
    if (declaration === null || declaration.type === 'VariableDeclarator') return { module, node, scopes };
    for (const unit of this.toDeclaration(module, declaration, node.name, null, types)) {
      const root = unit.roots.at(0)?.node;
      if (root?.type === 'FunctionDeclaration') return { module: unit.module, node: root, scopes };
      if (root?.type === 'VariableDeclarator' && root.init && isConst(unit.module, root)) {
        const at = scopesAt((unit.module.parsed as ParsedFile).program, root);
        return this.valueOf(unit.module, root.init, at, types, depth + 1);
      }
    }
    return { module, node, scopes };
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
      // An import in the unit's own code still names code elsewhere.
      if (declaration === null || (isOwn(declaration) && !IMPORT_BINDINGS.has(declaration.type))) return;
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
    /** The fixtures a call's functions ask for, when it registers a hook, a condition, a test or `use()` values. */
    const asks = (call: CallExpression, scopes: readonly Node[]) => {
      const { callee } = call;
      const name =
        callee.type === 'Identifier'
          ? callee.name
          : callee.type === 'MemberExpression' && !callee.computed
            ? callee.property.name
            : null;
      if (name === null) return;
      // A test object imported under another name, as Playwright's `import { test as setup }` for setup projects;
      // `mergeTests()` combines test objects, and isn't one.
      const declaration = callee.type === 'Identifier' ? module.values.declarationOf(callee.name, scopes) : null;
      const isMerge = declaration?.type === 'ImportSpecifier' && exportName(declaration.imported) === 'mergeTests';
      const isTest = declaration !== null && !isMerge && this.frameworkOf(module, callee, scopes, types) !== null;
      if (!(isTest || FIXTURE_CALLS.has(name) || CONDITION_CALLS.has(name) || USE_CALLS.has(name))) return;
      // A fixture's own `use(value)` callback is called by name; `test.use()` is a member.
      if (USE_CALLS.has(name) && callee.type !== 'MemberExpression') return;
      // `/^[A-Z]+$/.test(symbol)`, `assert.fail()` or `app.use()` don't run with fixtures.
      if (!this.isTestReference(module, callee, scopes, types)) return;
      const take = (value: Node) => {
        const uses = this.fixtureUses(module, value, scopes, types);
        unit.asks = unit.asks && uses && [...unit.asks, ...uses];
      };
      if (USE_CALLS.has(name)) {
        // `test.use(MARGIN_ACCOUNT)` is followed to the object, as written in place.
        for (const values of call.arguments.slice(0, 1)) {
          const { node } = this.valueOf(module, values, scopes, types);
          if (node.type === 'ObjectExpression') this.useValues(node, take);
          else take(values);
        }
        return;
      }
      for (const argument of call.arguments) {
        const { node } = this.valueOf(module, argument, scopes, types);
        if (CONDITION_CALLS.has(name)) {
          // A condition's value, as in `test.skip(isCI)`, isn't a function of the fixtures.
          if (node.type === 'FunctionDeclaration' || isFunctionNode(node)) take(argument);
        } else if (!isPlainValue(node)) {
          // A title or options, or else a function, also one a factory, a member or a condition gives.
          take(argument);
        }
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
          asks(node, scopes);
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

/** The first string literal with a value in a tree, in source order; null when there is none. */
function literalIn(node: Node, value: string): Span | null {
  if (node.type === 'Literal' && node.value === value) return node;
  for (const child of childNodes(node)) {
    const found = literalIn(child, value);
    if (found) return found;
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
  runsWith: RunsWith = { config: null, modules: [], gaps: [] },
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
  const config = [
    ...(runsWith.config ? [graph.runUnit(runsWith.config, true)] : []),
    ...runsWith.modules.map((module) => graph.runUnit(module, false)),
    ...runsWith.gaps.map((gap) => graph.gapUnit(gap)),
  ];
  const base = graph.reach([load, ...config]);
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
