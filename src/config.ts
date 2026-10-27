import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ArrayExpression, CallExpression, Expression, Node, ObjectExpression } from 'oxc-parser';
import { isFunctionNode, propertyKey, propertyName, returnValues, unwrap, type FunctionNode } from './ast.ts';
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
import type { ConfigRecord, Diagnostic, Framework } from './types.ts';
import { isKey, isScopeNode, Values, type Value } from './values.ts';

/** Config file names in the order each runner looks for them in a folder. */
const CONFIG_FILES: Record<Framework, string[]> = {
  playwright: ['.ts', '.js', '.mts', '.mjs', '.cts', '.cjs'].map((extension) => `playwright.config${extension}`),
  vitest: ['vitest.config', 'vite.config'].flatMap((name) =>
    ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'].map((extension) => name + extension),
  ),
};

/** The functions configs are written with, which return the config they are given or merge the ones they are given. */
const CONFIG_FUNCTIONS = new Set(['defineConfig', 'defineProject', 'mergeConfig']);

/** A file a config is read from: the config itself, or a module it imports settings from. */
interface ConfigFrame {
  parsed: ParsedFile;
  values: Values;
  relativeFilePath: string;
  readModule: ModuleReader;
}

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
  | ObjectSetting
  | { kind: 'list'; items: Setting[] }
  | Unknown;

interface ObjectSetting {
  kind: 'object';
  keys: Map<string, Setting>;
  rest: Unknown | null;
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
function mergeDeep(base: Setting, over: Setting): Setting {
  if (isNullish(over)) return base;
  if (isNullish(base) || over.kind === 'unknown') return over;
  if (base.kind === 'list' || over.kind === 'list') {
    // A list joined to one the scan can't work out can't be worked out either.
    if (base.kind === 'unknown') return base;
    const items = (setting: Setting) => (setting.kind === 'list' ? setting.items : [setting]);
    return { kind: 'list', items: [...items(base), ...items(over)] };
  }
  if (over.kind !== 'object' || base.kind === 'value') return over;
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
  private readonly frames = new Map<ModuleSource, ConfigFrame>();
  /** Constants and exports worked out, each once however often the config refers to it. */
  private readonly done = new Map<unknown, Setting | null>();
  /** Constants and exports being worked out, to stop at one that refers back to itself. */
  private readonly pending = new Set<unknown>();

  constructor(main: ConfigFrame, framework: Framework) {
    this.main = main;
    this.framework = framework;
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
      case 'Identifier': {
        const named = this.named(expression.name, frame, scopes, site);
        if (named) return named;
        break;
      }
      case 'MemberExpression': {
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
    if (constant) return this.once(constant.init, site, () => this.evaluate(constant.init, frame, constant.scopes));
    const declaration = frame.values.declarationOf(name, scopes);
    if (declaration?.type !== 'ImportSpecifier' && declaration?.type !== 'ImportDefaultSpecifier') return null;
    const imported = declaration.type === 'ImportSpecifier' ? exportName(declaration.imported) : 'default';
    const source = frame.values.importSource(name, scopes) as string;
    return this.fromModule(frame, source, imported, site) ?? unknown(site);
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

  /** A call of `defineConfig()`, `defineProject()` or `mergeConfig()`; any other call can't be worked out. */
  private call(call: CallExpression, frame: ConfigFrame, scopes: readonly Node[]): Setting {
    const site = { frame, node: call };
    const name = this.configFunction(call, frame, scopes);
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
   * The name of a config function called, as its package exports it, through `import { name } from 'package'` or
   * `const { name } = require('package')`; null for one the config declares or takes from a local file.
   */
  private configFunction(call: CallExpression, frame: ConfigFrame, scopes: readonly Node[]): string | null {
    const callee = unwrap(call.callee);
    if (callee.type !== 'Identifier') return null;
    const declaration = frame.values.declarationOf(callee.name, scopes);
    let name: string | null = declaration === null ? callee.name : null;
    let source: string | null = null;
    if (declaration?.type === 'ImportSpecifier') {
      name = exportName(declaration.imported);
      source = frame.values.importSource(callee.name, scopes);
    }
    if (declaration?.type === 'VariableDeclarator' && declaration.id.type === 'ObjectPattern' && declaration.init) {
      for (const item of declaration.id.properties) {
        if (item.type === 'Property' && item.value.type === 'Identifier' && item.value.name === callee.name) {
          name = propertyKey(item);
        }
      }
      source = requiredModule(declaration.init);
    }
    const fromPackage = declaration === null || (source !== null && !/^[./#]/.test(source));
    return fromPackage && name !== null && CONFIG_FUNCTIONS.has(name) ? name : null;
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
  record: ConfigRecord;
  settings: Setting;
}

/** Finds and reads the configs of one scan, and collects what it can't work out in them as diagnostics. */
export class Configs {
  readonly diagnostics: Diagnostic[] = [];
  private readonly root: string;
  private readonly framework: Framework;
  private readonly readerFor: (fromFile: string) => ModuleReader;
  private readonly nearest = new Map<string, ConfigFile | null>();
  private readonly used = new Set<ConfigFile>();
  private readonly reported = new Set<string>();

  constructor(root: string, framework: Framework, readerFor: (fromFile: string) => ModuleReader) {
    this.root = root;
    this.framework = framework;
    this.readerFor = readerFor;
  }

  /**
   * The config a file uses: the nearest in its folder or a folder above, up to the root, as the runner started in that
   * folder would use; null when there is none.
   */
  configFor(file: string): ConfigFile | null {
    const config = this.inFolder(path.dirname(file));
    if (config) this.used.add(config);
    return config;
  }

  /** The configs the files asked about use, sorted by path. */
  records(): ConfigRecord[] {
    // The default sort compares UTF-16 code units, so the order is the same on every machine and locale.
    const byPath = new Map([...this.used].map((config) => [config.record.relativeFilePath, config.record]));
    return [...byPath.keys()].sort().map((key) => byPath.get(key) as ConfigRecord);
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

  private inFolder(folder: string): ConfigFile | null {
    let config = this.nearest.get(folder);
    if (config === undefined) {
      // The runners take a config that exists, without checking that it is a file they can read.
      const name = CONFIG_FILES[this.framework].find((item) => existsSync(path.join(folder, item)));
      const parent = path.dirname(folder);
      if (name) config = this.read(path.join(folder, name));
      else config = folder === this.root || parent === folder ? null : this.inFolder(parent);
      this.nearest.set(folder, config);
    }
    return config;
  }

  private read(file: string): ConfigFile {
    const relativeFilePath = path.relative(this.root, file).replaceAll('\\', '/');
    const unreadable = (diagnostic: Diagnostic): ConfigFile => {
      this.diagnostics.push(diagnostic);
      return { record: { relativeFilePath, extends: [] }, settings: { kind: 'unknown', where: null } };
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
    const frame = { parsed, values: new Values(), relativeFilePath, readModule: this.readerFor(file) };
    const config = new ConfigCode(frame, this.framework);
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
    return { record: { relativeFilePath, extends: config.followed }, settings };
  }
}
