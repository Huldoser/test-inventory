import type { Expression, Program } from 'oxc-parser';
import { commonJsExport, commonJsNames, ownExport, parseModule, starReexport } from './frameworks/bindings.ts';
import type { ModuleReader, ModuleSource } from './model.ts';
import { Values, type ImportReader, type Resolved, type Value } from './values.ts';

const UNRESOLVED: Resolved = { ok: false, importedFrom: null };

/** How many modules deep a name is followed through re-exports and imports, as for test objects. */
const MAX_DEPTH = 16;

interface OpenedModule {
  program: Program | null;
  /** The value of a JSON module. */
  json: { value: Value } | null;
  values: Values;
}

/**
 * Works out the values project modules export, for the files of one scan: each module is parsed once and each of its
 * exports worked out once, however many test files import it. Installed packages are never read, since the reader
 * only gives project files.
 */
export class ExportedValues {
  private readonly modules = new WeakMap<ModuleSource, OpenedModule | null>();
  private readonly done = new Map<string, Resolved | null>();
  /** Results of the current lookup, also those that `done` can't keep, so that each module is read once in it. */
  private readonly current = new Map<string, Resolved | null>();
  private readonly pending = new Set<string>();
  /** How many times a lookup was cut short by a cycle or the depth limit. */
  private cutShort = 0;

  /** What a file that reads its imports with `readModule` gets for `import { name } from source`. */
  reader(readModule: ModuleReader | null): ImportReader | null {
    if (!readModule) return null;
    return (source, name) => {
      const module = readModule(source);
      if ('reason' in module) return UNRESOLVED;
      return this.exported(module, name) ?? UNRESOLVED;
    };
  }

  /** What `module` exports under `name`; null when it doesn't export it. */
  private exported(module: ModuleSource, name: string): Resolved | null {
    const key = `${module.relativeFilePath}\0${name}`;
    if (this.done.has(key)) return this.done.get(key) as Resolved | null;
    if (this.current.has(key)) {
      // It was worked out on a path that was cut short, so what is built on it depends on that path too.
      this.cutShort++;
      return this.current.get(key) as Resolved | null;
    }
    // A path that comes back to a name being worked out, as `export *` modules that re-export each other do, gives
    // nothing; another path may still give it.
    if (this.pending.has(key) || this.pending.size >= MAX_DEPTH) {
      this.cutShort++;
      return this.pending.has(key) ? null : UNRESOLVED;
    }
    const before = this.cutShort;
    this.pending.add(key);
    const result = this.read(module, name);
    this.pending.delete(key);
    // A result found while a path was cut short depends on where the lookup began, so only this lookup keeps it.
    if (this.cutShort === before) this.done.set(key, result);
    else this.current.set(key, result);
    if (this.pending.size === 0) this.current.clear();
    return result;
  }

  private read(module: ModuleSource, name: string): Resolved | null {
    const opened = this.open(module);
    if (!opened) return UNRESOLVED;
    if (opened.json) return jsonExport(opened.json.value, name);
    const program = opened.program as Program;
    for (const statement of program.body) {
      const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : null;
      if (declaration?.type === 'TSEnumDeclaration' && declaration.id.name === name) {
        return opened.values.resolveName(name, [program]);
      }
    }
    const own = ownExport(program, name);
    if (own?.kind === 'default') return opened.values.resolve(own.value, [program]);
    if (own?.kind === 'function') return UNRESOLVED;
    if (own?.kind === 'specifier' && own.source !== null) {
      const from = module.readModule(own.source);
      return 'reason' in from ? UNRESOLVED : (this.exported(from, own.local) ?? UNRESOLVED);
    }
    if (own) {
      return opened.values.resolveName(own.kind === 'specifier' ? own.local : name, [program]);
    }
    const commonJs = commonJsExport(program, name);
    if (commonJs) return opened.values.resolve(commonJs, [program]);
    // What `require()` gives for a module that exports its names one by one: an object of them.
    const names = name === 'default' ? commonJsNames(program) : [];
    if (names.length > 0) {
      const entries = names.map(
        (item) => [item, opened.values.resolve(commonJsExport(program, item) as Expression, [program])] as const,
      );
      if (!entries.every(([, value]) => value.ok)) return UNRESOLVED;
      return {
        ok: true,
        value: Object.fromEntries(entries.map(([key, value]) => [key, (value as { value: Value }).value])),
      };
    }
    // `export *` passes on every name but the default. When two modules export the name with different values, Node
    // refuses to load the module and Vite's module runner keeps the first, so the value isn't known.
    if (name === 'default') return null;
    let found: Resolved | null = null;
    for (const statement of program.body) {
      const source = starReexport(statement);
      const from = source === null ? null : module.readModule(source);
      const result = from && !('reason' in from) ? this.exported(from, name) : null;
      if (!result) continue;
      if (found && !(found.ok && result.ok && JSON.stringify(found.value) === JSON.stringify(result.value))) {
        return UNRESOLVED;
      }
      found = result;
    }
    return found;
  }

  private open(module: ModuleSource): OpenedModule | null {
    if (this.modules.has(module)) return this.modules.get(module) as OpenedModule | null;
    let opened: OpenedModule | null = null;
    if (module.relativeFilePath.endsWith('.json')) {
      const value = parseJson(module.code);
      opened = value === undefined ? null : { program: null, json: { value }, values: new Values() };
    } else if (!module.bytes) {
      const parsed = parseModule(module);
      const values = new Values(this.reader(module.readModule));
      opened = parsed.error ? null : { program: parsed.program, json: null, values };
    }
    this.modules.set(module, opened);
    return opened;
  }
}

function parseJson(code: string): Value | undefined {
  try {
    return JSON.parse(code) as Value;
  } catch {
    return undefined;
  }
}

/** A JSON module's default export is its value; Vite and Playwright also export its top-level keys by name. */
function jsonExport(value: Value, name: string): Resolved | null {
  if (name === 'default') return { ok: true, value };
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.hasOwn(value, name)) {
    return { ok: true, value: value[name] };
  }
  return null;
}
