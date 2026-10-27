import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  Argument,
  ArrayExpression,
  CallExpression,
  Expression,
  NewExpression,
  Node,
  ObjectExpression,
} from 'oxc-parser';
import {
  childNodes,
  isFunctionNode,
  propertyKey,
  propertyName,
  returnValues,
  unwrap,
  type FunctionNode,
} from './ast.ts';
import { fileDiagnostic, toDiagnostic } from './diagnostics.ts';
import { readFailure } from './files.ts';
import {
  exportName,
  moduleExportsValue,
  ownExport,
  parseModule,
  requiredModule,
  starReexport,
} from './frameworks/bindings.ts';
import { problem } from './frameworks/common.ts';
import type { ModuleReader, ModuleSource, Span } from './model.ts';
import { parseFile, type ParsedFile } from './parse.ts';
import { snippet } from './source.ts';
import type { ConfigRecord, Diagnostic, Framework, ProjectRecord } from './types.ts';
import { isKey, isScopeNode, Values, type Value } from './values.ts';
import { VITEST_INCLUDE, VITEST_TYPECHECK_INCLUDE, vitestExclude } from './vitest-defaults.ts';

/** Config file names in the order each runner looks for them in a folder. */
const CONFIG_FILES: Record<Framework, string[]> = {
  playwright: ['.ts', '.js', '.mts', '.mjs', '.cts', '.cjs'].map((extension) => `playwright.config${extension}`),
  vitest: ['vitest.config', 'vite.config'].flatMap((name) =>
    ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'].map((extension) => name + extension),
  ),
};

/** Methods that change the object or list they are called on. */
const CHANGING_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);

/** A change a module makes to a constant after declaring it: to one of its keys, or to all of it when `key` is null. */
interface Change {
  key: string | null;
  node: Node;
}

/**
 * The changes a module makes to its constants after declaring them, by declaration: assignments to their members,
 * `delete`, `++`, methods such as `push()` and `Object.assign()`, as a config that fills `projects` in a loop does.
 */
function changesIn(parsed: ParsedFile, values: Values): Map<Node, Change[]> {
  const changes = new Map<Node, Change[]>();
  const scopes: Node[] = [];
  const record = (target: Expression, node: Node) => {
    let expression = unwrap(target);
    let key: string | null = null;
    while (expression.type === 'MemberExpression') {
      key = propertyName(expression);
      expression = unwrap(expression.object);
    }
    const declaration = expression.type === 'Identifier' ? values.declarationOf(expression.name, scopes) : null;
    if (declaration) changes.set(declaration, [...(changes.get(declaration) ?? []), { key, node }]);
  };
  const visit = (node: Node) => {
    const isScope = isScopeNode(node);
    if (isScope) scopes.push(node);
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') record(node.left, node);
    if (node.type === 'UpdateExpression' || (node.type === 'UnaryExpression' && node.operator === 'delete')) {
      record(node.argument, node);
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      const method = propertyName(node.callee);
      const isAssign =
        method === 'assign' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'Object';
      if (isAssign && node.arguments[0] && node.arguments[0].type !== 'SpreadElement') record(node.arguments[0], node);
      else if (CHANGING_METHODS.has(method ?? '')) record(node.callee.object, node);
    }
    for (const child of childNodes(node)) visit(child);
    if (isScope) scopes.pop();
  };
  visit(parsed.program);
  return changes;
}

/** The functions configs are written with, which return the config they are given or merge the ones they are given. */
const CONFIG_FUNCTIONS = new Set(['defineConfig', 'defineProject', 'mergeConfig']);

/** A file a config is read from: the config itself, or a module it imports settings from, at `file`. */
interface ConfigFrame {
  parsed: ParsedFile;
  values: Values;
  relativeFilePath: string;
  file: string;
  readModule: ModuleReader;
}

/** Where a function a config calls comes from: the module, or `''` for a global, and the name it exports it under. */
interface Origin {
  source: string;
  name: string;
}

/**
 * Node.js path functions a config builds its folders with, given the folder the runner starts in: the root, which
 * `path.resolve()` resolves a relative path from.
 */
const PATH_FUNCTIONS: Record<string, (root: string, ...parts: string[]) => string> = {
  'path.join': (_, ...parts) => path.join(...parts),
  'path.resolve': (root, ...parts) => path.resolve(root, ...parts),
  'path.dirname': (_, part) => path.dirname(part),
  'url.fileURLToPath': (_, url) => fileURLToPath(url),
};

/** Where an expression is written. */
interface Site {
  frame: ConfigFrame;
  node: Span;
}

/** A setting the scan can't work out without running the config. `where` is null for a config it couldn't read at all. */
export interface Unknown {
  kind: 'unknown';
  where: Site | null;
}

/**
 * A config setting: a value, an object or a list of settings, or one the scan can't work out. An object's `rest` is a
 * spread the scan can't work out, which may set any key not written after it.
 */
export type Setting =
  | { kind: 'value'; value: string | number | boolean | null | undefined }
  | { kind: 'regex'; source: string; flags: string }
  | ObjectSetting
  | { kind: 'list'; items: Setting[] }
  | Unknown;

export interface ObjectSetting {
  kind: 'object';
  keys: Map<string, Setting>;
  rest: Unknown | null;
}

/** What `read` returns, or null when it throws, as `fileURLToPath()` does for a URL that isn't a file's. */
function attempt(read: () => string): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

function unknown(where: Site): Unknown {
  return { kind: 'unknown', where };
}

function emptyObject(): ObjectSetting {
  return { kind: 'object', keys: new Map(), rest: null };
}

function fromValue(value: Value): Setting {
  if (Array.isArray(value)) return { kind: 'list', items: value.map(fromValue) };
  if (typeof value === 'object' && value !== null) {
    const keys = new Map(Object.entries(value).map(([key, item]) => [key, fromValue(item)]));
    return { kind: 'object', keys, rest: null };
  }
  return { kind: 'value', value };
}

/** The source text of a setting the scan can't work out; null for one of a config it couldn't read at all. */
export function unknownText(setting: Unknown): string | null {
  const { where } = setting;
  return where && snippet(where.frame.parsed.source.text.slice(where.node.start, where.node.end));
}

/** The setting under a key; null when the config doesn't set it. */
function child(setting: Setting, key: string): Setting | null {
  if (setting.kind === 'unknown') return setting;
  if (setting.kind !== 'object') return null;
  return setting.keys.get(key) ?? setting.rest;
}

/** The setting under a path of keys, such as `['test', 'globals']`; null when the config doesn't set it. */
export function settingAt(setting: Setting, keys: readonly string[]): Setting | null {
  return keys.reduce<Setting | null>((current, key) => (current === null ? null : child(current, key)), setting);
}

function isNullish(setting: Setting): boolean {
  return setting.kind === 'value' && (setting.value === null || setting.value === undefined);
}

/**
 * `{ ...base, ...over }`: each key `over` sets replaces the one in `base`, and a spread of `over` that the scan can't
 * work out may replace any. `at` is where the spread is written. A copy when `over` sets anything.
 */
function spread(base: ObjectSetting, over: Setting, at: Site): ObjectSetting {
  // Spreading null, undefined, a boolean or a number adds nothing.
  if (over.kind === 'value' && typeof over.value !== 'string') return base;
  if (over.kind !== 'object') return { kind: 'object', keys: new Map(), rest: unknown(at) };
  if (over.rest) return { kind: 'object', keys: new Map(over.keys), rest: over.rest };
  return { kind: 'object', keys: new Map([...base.keys, ...over.keys]), rest: base.rest };
}

/**
 * One of two settings, as the two sides of a condition: what both agree on is known, and the rest is unknown at `at`,
 * where the condition is written. Null is a setting neither side sets.
 */
function either(a: Setting | null, b: Setting | null, at: Site): Setting {
  if (a !== null && (a === b || (a.kind === 'value' && b?.kind === 'value' && a.value === b.value))) return a;
  if (a?.kind !== 'object' || b?.kind !== 'object') return unknown(at);
  const keys = new Map<string, Setting>();
  for (const key of new Set([...a.keys.keys(), ...b.keys.keys()]))
    keys.set(key, either(child(a, key), child(b, key), at));
  return { kind: 'object', keys, rest: a.rest === b.rest ? a.rest : unknown(at) };
}

/**
 * Vite's `mergeConfig(base, over)`: objects merge key by key, lists are joined with a single setting taken as a list
 * of one, and `null` or `undefined` keeps the other side.
 */
export function mergeDeep(base: Setting, over: Setting): Setting {
  if (isNullish(over)) return base;
  if (isNullish(base) || over.kind === 'unknown') return over;
  if (base.kind === 'list' || over.kind === 'list') {
    // A list joined to one the scan can't work out can't be worked out either.
    if (base.kind === 'unknown') return base;
    const items = (setting: Setting) => (setting.kind === 'list' ? setting.items : [setting]);
    return { kind: 'list', items: [...items(base), ...items(over)] };
  }
  if (over.kind !== 'object' || (base.kind !== 'object' && base.kind !== 'unknown')) return over;
  const keys = new Map(base.kind === 'object' && !over.rest ? base.keys : []);
  for (const [key, value] of over.keys) {
    const existing = child(base, key);
    keys.set(key, existing ? mergeDeep(existing, value) : value);
  }
  return { kind: 'object', keys, rest: over.rest ?? (base.kind === 'object' ? base.rest : base) };
}

/** Works out a config's settings from its code, following the modules it imports them from. */
class ConfigCode {
  /** The modules read for the config besides itself, in the order they were first followed. */
  readonly followed: string[] = [];
  private readonly main: ConfigFrame;
  private readonly framework: Framework;
  private readonly root: string;
  private readonly version: [number, number] | null;
  private readonly frames = new Map<ModuleSource, ConfigFrame>();
  private readonly changes = new Map<ConfigFrame, Map<Node, Change[]>>();
  /** Constants and exports worked out, each once however often the config refers to it. */
  private readonly done = new Map<unknown, Setting | null>();
  /** Constants and exports being worked out, to stop at one that refers back to itself. */
  private readonly pending = new Set<unknown>();

  constructor(main: ConfigFrame, framework: Framework, root: string, version: [number, number] | null) {
    this.main = main;
    this.framework = framework;
    this.root = root;
    this.version = version;
  }

  /** What a module exports under a name; null when it doesn't export it. `site` is where the name is imported. */
  exported(frame: ConfigFrame, name: string, site: Site): Setting | null {
    const { program } = frame.parsed;
    const own = ownExport(program, name);
    if (own?.kind === 'default') return this.evaluate(own.value, frame, [program]);
    if (own) {
      const at = { frame, node: own.statement };
      const found =
        own.kind === 'specifier' && own.source !== null
          ? this.fromModule(frame, own.source, own.local, at)
          : this.named(own.kind === 'specifier' ? own.local : name, frame, [program], at);
      return found ?? unknown(at);
    }
    if (name === 'default') {
      // `export *` passes on every name but the default.
      const commonJs = program.body.map(moduleExportsValue).find((value) => value !== null);
      return commonJs ? this.evaluate(commonJs, frame, [program]) : null;
    }
    for (const statement of program.body) {
      const source = starReexport(statement);
      const found = source === null ? null : this.fromModule(frame, source, name, site);
      if (found) return found;
    }
    return null;
  }

  /** Works out an expression; `scopes` are the scope nodes around it, outermost first. */
  private evaluate(node: Expression, frame: ConfigFrame, scopes: readonly Node[]): Setting {
    const expression = unwrap(node);
    const site = { frame, node: expression };
    switch (expression.type) {
      case 'ObjectExpression':
        return this.object(expression, frame, scopes);
      case 'ArrayExpression':
        return this.list(expression, frame, scopes);
      case 'CallExpression':
        return this.call(expression, frame, scopes);
      case 'NewExpression':
        return this.newUrl(expression, frame, scopes);
      case 'Literal':
        if ('regex' in expression)
          return { kind: 'regex', source: expression.regex.pattern, flags: expression.regex.flags };
        break;
      case 'Identifier': {
        const named = this.named(expression.name, frame, scopes, site);
        if (named) return named;
        // Vite and Playwright give a config `__dirname` and `__filename`, also in an ES module.
        const isGlobal = frame.values.declarationOf(expression.name, scopes) === null;
        if (isGlobal && expression.name === '__dirname') return { kind: 'value', value: path.dirname(frame.file) };
        if (isGlobal && expression.name === '__filename') return { kind: 'value', value: frame.file };
        break;
      }
      case 'MemberExpression': {
        if (expression.object.type === 'MetaProperty') return this.importMeta(propertyName(expression), frame, site);
        // A member of an object written in the config, as in `shared.test`, keeps what the scan can't work out in it.
        const name = propertyName(expression);
        if (name === null) break;
        const object = this.evaluate(expression.object, frame, scopes);
        const found = object.kind === 'object' ? child(object, name) : null;
        if (found) return found;
        break;
      }
    }
    const resolved = frame.values.resolve(expression, scopes);
    return resolved.ok ? fromValue(resolved.value) : unknown(site);
  }

  /**
   * What a name refers to: a constant written in the module, or what another module exports under the imported name;
   * null for any other name, whose value the file's own evaluation works out if it can.
   */
  private named(name: string, frame: ConfigFrame, scopes: readonly Node[], site: Site): Setting | null {
    const constant = frame.values.constantOf(name, scopes);
    const declaration = frame.values.declarationOf(name, scopes);
    if (constant) {
      const setting = this.once(constant.init, site, () => this.evaluate(constant.init, frame, constant.scopes));
      return this.changed(setting, frame, declaration as Node);
    }
    if (declaration?.type !== 'ImportSpecifier' && declaration?.type !== 'ImportDefaultSpecifier') return null;
    const imported = declaration.type === 'ImportSpecifier' ? exportName(declaration.imported) : 'default';
    const source = frame.values.importSource(name, scopes) as string;
    if (source === 'vitest/config' || source === 'vitest/node') {
      const defaults = this.vitestDefaults(imported, site);
      if (defaults) return defaults;
    }
    return this.fromModule(frame, source, imported, site) ?? unknown(site);
  }

  /**
   * The defaults Vitest exports from `vitest/config`, for the version of the project: `defaultInclude`,
   * `defaultExclude`, and of `configDefaults` the file settings, the others being unknown at `site`.
   */
  private vitestDefaults(name: string, site: Site): Setting | null {
    const exclude = vitestExclude(this.version);
    if (name === 'defaultInclude') return fromValue(VITEST_INCLUDE);
    if (name === 'defaultExclude') return fromValue(exclude);
    if (name !== 'configDefaults') return null;
    const typecheck = fromValue({ include: VITEST_TYPECHECK_INCLUDE, exclude }) as ObjectSetting;
    const defaults = fromValue({ include: VITEST_INCLUDE, exclude, includeSource: [] }) as ObjectSetting;
    defaults.keys.set('typecheck', { ...typecheck, rest: unknown(site) });
    return { ...defaults, rest: unknown(site) };
  }

  /**
   * A constant's setting as the module leaves it: a key it changes later is unknown there, and all of it when the
   * module changes the whole object or a list.
   */
  private changed(setting: Setting, frame: ConfigFrame, declaration: Node): Setting {
    let found = this.changes.get(frame);
    if (!found) {
      found = changesIn(frame.parsed, frame.values);
      this.changes.set(frame, found);
    }
    const changes = found.get(declaration) ?? [];
    if (changes.length === 0) return setting;
    // A change to a list or a value changes all of it.
    if (setting.kind !== 'object') return unknown({ frame, node: changes[0].node });
    const whole = changes.find((change) => change.key === null);
    if (whole) return unknown({ frame, node: whole.node });
    const keys = new Map(setting.keys);
    for (const { key, node } of changes) keys.set(key as string, unknown({ frame, node }));
    return { ...setting, keys };
  }

  /** What a module an import names exports under a name; null when the module doesn't export it. */
  private fromModule(frame: ConfigFrame, specifier: string, name: string, site: Site): Setting | null {
    const module = this.open(frame, specifier);
    if (!module) return unknown(site);
    return this.once(`${module.relativeFilePath}\0${name}`, site, () => this.exported(module, name, site));
  }

  private once<T extends Setting | null>(key: unknown, site: Site, read: () => T): T | Unknown {
    if (this.done.has(key)) return this.done.get(key) as T;
    if (this.pending.has(key)) return unknown(site);
    this.pending.add(key);
    const result = read();
    this.pending.delete(key);
    this.done.set(key, result);
    return result;
  }

  /** A module a config file imports, read once; null when it isn't a local file or can't be parsed. */
  private open(frame: ConfigFrame, specifier: string): ConfigFrame | null {
    const module = frame.readModule(specifier);
    if ('reason' in module) return null;
    let opened = this.frames.get(module);
    if (!opened) {
      const parsed = parseModule(module);
      if (parsed.error) return null;
      opened = {
        parsed,
        values: new Values(),
        relativeFilePath: module.relativeFilePath,
        file: path.resolve(this.root, module.relativeFilePath),
        readModule: module.readModule,
      };
      this.frames.set(module, opened);
      if (module.relativeFilePath !== this.main.relativeFilePath) this.followed.push(module.relativeFilePath);
    }
    return opened;
  }

  private object(node: ObjectExpression, frame: ConfigFrame, scopes: readonly Node[]): Setting {
    let object = emptyObject();
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        object = this.spreadInto(object, property.argument, frame, scopes);
        continue;
      }
      const key =
        !property.computed && property.key.type === 'Identifier'
          ? { ok: true as const, value: property.key.name }
          : frame.values.resolve(property.key as Expression, scopes);
      if (!key.ok || !isKey(key.value)) {
        // The key could be any name, so it may replace any setting written before it.
        object = { kind: 'object', keys: new Map(), rest: unknown({ frame, node: property.key }) };
        continue;
      }
      // A method or getter is a function, which the scan can't work out.
      object.keys.set(String(key.value), this.evaluate(property.value, frame, scopes));
    }
    return object;
  }

  /**
   * `{ ...object, ...argument }`, also for an argument that picks between two objects, as in
   * `...(process.env.CI ? { retry: 2 } : {})` or `...(process.env.CI && { retry: 2 })`.
   */
  private spreadInto(
    object: ObjectSetting,
    argument: Expression,
    frame: ConfigFrame,
    scopes: readonly Node[],
  ): ObjectSetting {
    const node = unwrap(argument);
    const at = { frame, node };
    const spreadOf = (expression: Expression) => spread(object, this.evaluate(expression, frame, scopes), at);
    if (node.type === 'ConditionalExpression') {
      return either(spreadOf(node.consequent), spreadOf(node.alternate), at) as ObjectSetting;
    }
    // When the left side is false, so is the whole, and spreading it adds nothing.
    if (node.type === 'LogicalExpression' && node.operator === '&&') {
      return either(object, spreadOf(node.right), at) as ObjectSetting;
    }
    return spreadOf(node);
  }

  private list(node: ArrayExpression, frame: ConfigFrame, scopes: readonly Node[]): Setting {
    const items: Setting[] = [];
    for (const element of node.elements) {
      if (element === null) return unknown({ frame, node });
      if (element.type !== 'SpreadElement') {
        items.push(this.evaluate(element, frame, scopes));
        continue;
      }
      const spreadList = this.evaluate(element.argument, frame, scopes);
      if (spreadList.kind !== 'list') return unknown({ frame, node: element });
      items.push(...spreadList.items);
    }
    return { kind: 'list', items };
  }

  /** `import.meta.dirname`, `filename` and `url` of the file. */
  private importMeta(name: string | null, frame: ConfigFrame, site: Site): Setting {
    if (name === 'dirname') return { kind: 'value', value: path.dirname(frame.file) };
    if (name === 'filename') return { kind: 'value', value: frame.file };
    return name === 'url' ? { kind: 'value', value: pathToFileURL(frame.file).href } : unknown(site);
  }

  /** `new URL(path, base)`, as in `new URL('./e2e', import.meta.url)`, as the URL's text. */
  private newUrl(node: NewExpression, frame: ConfigFrame, scopes: readonly Node[]): Setting {
    const isUrl = node.callee.type === 'Identifier' && node.callee.name === 'URL';
    const parts = isUrl ? this.strings(node.arguments, frame, scopes) : null;
    const url = parts && URL.parse(parts[0], parts[1]);
    return url ? { kind: 'value', value: url.href } : unknown({ frame, node });
  }

  /** The values of arguments that are all strings; null when one isn't, or is a spread. */
  private strings(args: readonly Argument[], frame: ConfigFrame, scopes: readonly Node[]): string[] | null {
    const values = args.map((arg) => (arg.type === 'SpreadElement' ? null : this.evaluate(arg, frame, scopes)));
    return values.every((value) => value?.kind === 'value' && typeof value.value === 'string')
      ? values.map((value) => (value as { value: string }).value)
      : null;
  }

  /**
   * A call of `defineConfig()`, `defineProject()` or `mergeConfig()`, or of a Node.js path function such as
   * `path.join(__dirname, 'e2e')`; any other call can't be worked out.
   */
  private call(call: CallExpression, frame: ConfigFrame, scopes: readonly Node[]): Setting {
    const site = { frame, node: call };
    const origin = this.origin(unwrap(call.callee), frame, scopes);
    const pathFunction = origin && PATH_FUNCTIONS[`${origin.source.replace(/^node:/, '')}.${origin.name}`];
    if (pathFunction) {
      const parts = this.strings(call.arguments, frame, scopes);
      const file = parts && attempt(() => pathFunction(this.root, ...parts));
      return file === null ? unknown(site) : { kind: 'value', value: file };
    }
    const isPackage = origin !== null && (origin.source === '' || !/^[./#]/.test(origin.source));
    const name = isPackage && CONFIG_FUNCTIONS.has(origin.name) ? origin.name : null;
    const { arguments: given } = call;
    const needed = name === 'mergeConfig' ? 2 : 1;
    if (name === null || given.length < needed || given.some((arg) => arg.type === 'SpreadElement')) {
      return unknown(site);
    }
    const args = given as Expression[];
    if (name === 'mergeConfig') {
      const [base, over] = args.map((arg) => this.evaluate(arg, frame, scopes));
      return mergeDeep(base, over);
    }
    if (this.framework === 'vitest') {
      // Vitest's defineConfig() and defineProject() return the config they are given, or the one a function returns.
      return isFunctionNode(args[0]) ? this.returned(args[0], frame, scopes) : this.evaluate(args[0], frame, scopes);
    }
    // Playwright's defineConfig() merges the configs it is given, each over the ones before it. It also merges their
    // `use`, `expect`, `build`, `webServer` and `projects`, which the scan doesn't read yet.
    return args.reduce(
      (merged, arg) => spread(merged, this.evaluate(arg, frame, scopes), { frame, node: arg }),
      emptyObject(),
    );
  }

  /**
   * Where a function a config calls comes from: `name` of `import { name } from 'module'` or
   * `const { name } = require('module')`, `module.name` of a default or namespace import or a `require()`, or a global;
   * null for one the config declares itself.
   */
  private origin(callee: Expression, frame: ConfigFrame, scopes: readonly Node[]): Origin | null {
    const member = callee.type === 'MemberExpression' ? propertyName(callee) : null;
    const base =
      member === null ? callee : unwrap((callee as Extract<Expression, { type: 'MemberExpression' }>).object);
    if (base.type !== 'Identifier') return null;
    const declaration = frame.values.declarationOf(base.name, scopes);
    if (declaration === null) return member === null ? { source: '', name: base.name } : null;
    const source =
      declaration.type === 'VariableDeclarator'
        ? declaration.init && requiredModule(declaration.init)
        : frame.values.importSource(base.name, scopes);
    if (!source) return null;
    if (member !== null) {
      const whole = declaration.type === 'ImportDefaultSpecifier' || declaration.type === 'ImportNamespaceSpecifier';
      return whole || (declaration.type === 'VariableDeclarator' && declaration.id.type === 'Identifier')
        ? { source, name: member }
        : null;
    }
    if (declaration.type === 'ImportSpecifier') return { source, name: exportName(declaration.imported) };
    if (declaration.type !== 'VariableDeclarator' || declaration.id.type !== 'ObjectPattern') return null;
    for (const item of declaration.id.properties) {
      const isBinding = item.type === 'Property' && item.value.type === 'Identifier' && item.value.name === base.name;
      const key = isBinding ? propertyKey(item) : null;
      if (key !== null) return { source, name: key };
    }
    return null;
  }

  /** What a config function returns, when it has a single `return` the scan can follow. */
  private returned(fn: FunctionNode, frame: ConfigFrame, scopes: readonly Node[]): Setting {
    const values = returnValues(fn, true);
    if (values?.length !== 1) return unknown({ frame, node: fn });
    const [{ expression, around }] = values;
    return this.evaluate(expression, frame, [...scopes, fn, ...around.filter(isScopeNode)]);
  }
}

/** The config a scanned file uses, read once however many files use it. */
export interface ConfigFile {
  /** The config's absolute path. */
  file: string;
  record: Omit<ConfigRecord, 'projects'>;
  settings: Setting;
}

/** Finds and reads the configs of one scan, and collects what it can't work out in them as diagnostics. */
export class Configs {
  readonly diagnostics: Diagnostic[] = [];
  private readonly root: string;
  private readonly framework: Framework;
  private readonly readerFor: (fromFile: string) => ModuleReader;
  private readonly inFolders = new Map<string, ConfigFile | null>();
  private readonly files = new Map<string, ConfigFile>();
  private readonly used = new Set<ConfigFile>();
  private readonly reported = new Set<string>();
  private readonly version: [number, number] | null;

  constructor(
    root: string,
    framework: Framework,
    readerFor: (fromFile: string) => ModuleReader,
    version: [number, number] | null,
  ) {
    this.root = root;
    this.framework = framework;
    this.readerFor = readerFor;
    this.version = version;
  }

  /**
   * The configs in a file's folder and the folders above it, up to the root, outermost first: in each folder, the one
   * the runner started there would use.
   */
  around(file: string): ConfigFile[] {
    const configs: ConfigFile[] = [];
    for (let folder = path.dirname(file); ; folder = path.dirname(folder)) {
      const config = this.inFolder(folder);
      if (config) configs.unshift(config);
      if (folder === this.root || path.dirname(folder) === folder) return configs;
    }
  }

  /** The config at a path, read once however many files or projects refer to it. */
  at(file: string): ConfigFile {
    let config = this.files.get(file);
    if (!config) {
      config = this.read(file);
      this.files.set(file, config);
    }
    return config;
  }

  /** A path from the root, with `/` separators; `.` for the root itself. */
  relative(file: string): string {
    return path.relative(this.root, file).replaceAll('\\', '/') || '.';
  }

  /** Lists a config in the output, as one that scanned files use. */
  use(config: ConfigFile): void {
    this.used.add(config);
  }

  /** The configs that scanned files use, sorted by path, with the projects `projectsOf` gives each. */
  records(projectsOf: (config: ConfigFile) => ProjectRecord[] | null): ConfigRecord[] {
    // The default sort compares UTF-16 code units, so the order is the same on every machine and locale.
    const byPath = new Map([...this.used].map((config) => [config.record.relativeFilePath, config]));
    return [...byPath.keys()].sort().map((key) => {
      const config = byPath.get(key) as ConfigFile;
      return { ...config.record, projects: projectsOf(config) };
    });
  }

  /** Reports a setting the scan reads but can't work out, once; `key` names it, and `effect` says what the scan does. */
  reportUnknown(setting: Unknown, key: string, effect: string): void {
    if (setting.where === null) return;
    const { frame, node } = setting.where;
    const id = `${frame.relativeFilePath}\0${node.start}\0${key}`;
    if (this.reported.has(id)) return;
    this.reported.add(id);
    const message = `The config's ${key} could not be worked out without running the config, so ${effect}.`;
    const code = snippet(frame.parsed.source.text.slice(node.start, node.end));
    const found = problem('config-value-unknown', node, message, code);
    this.diagnostics.push(toDiagnostic(found, frame.relativeFilePath, frame.parsed.source));
  }

  /** The config the runner started in a folder would use; null when the folder has none. */
  inFolder(folder: string): ConfigFile | null {
    let config = this.inFolders.get(folder);
    if (config === undefined) {
      // The runners take a config that exists, without checking that it is a file they can read.
      const name = CONFIG_FILES[this.framework].find((item) => existsSync(path.join(folder, item)));
      config = name ? this.at(path.join(folder, name)) : null;
      this.inFolders.set(folder, config);
    }
    return config;
  }

  private read(file: string): ConfigFile {
    const relativeFilePath = path.relative(this.root, file).replaceAll('\\', '/');
    const unreadable = (diagnostic: Diagnostic): ConfigFile => {
      this.diagnostics.push(diagnostic);
      return { file, record: { relativeFilePath, extends: [] }, settings: { kind: 'unknown', where: null } };
    };
    const none = 'so the scan reads none of its settings.';
    let code: string;
    try {
      code = readFileSync(file, 'utf8');
    } catch (error) {
      const message = `The config could not be read: ${readFailure(error)}, ${none}`;
      return unreadable(fileDiagnostic('config-value-unknown', relativeFilePath, message));
    }
    const parsed = parseFile(relativeFilePath, code);
    if (parsed.error) {
      const { message, start, end } = parsed.error;
      const found = problem(
        'config-value-unknown',
        { start, end },
        `The config could not be parsed: ${message}, ${none}`,
        snippet(parsed.source.text.slice(start, end)) || null,
      );
      return unreadable(toDiagnostic(found, relativeFilePath, parsed.source));
    }
    const frame = { parsed, values: new Values(), relativeFilePath, file, readModule: this.readerFor(file) };
    const config = new ConfigCode(frame, this.framework, this.root, this.version);
    let settings: Setting | null;
    try {
      settings = config.exported(frame, 'default', { frame, node: parsed.program });
    } catch (error) {
      // The scan runs none of the project's code, so what fails here is its own and throws an Error.
      const raw = (error as Error).message;
      const message = `Reading the config failed unexpectedly: ${raw.replaceAll(this.root, '.')}, ${none}`;
      return unreadable(fileDiagnostic('internal-error', relativeFilePath, message));
    }
    if (settings === null) {
      const message = `The config has no default export the scan can find, ${none}`;
      return unreadable(fileDiagnostic('config-value-unknown', relativeFilePath, message));
    }
    return { file, record: { relativeFilePath, extends: config.followed }, settings };
  }
}
