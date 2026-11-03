import type { Program } from 'oxc-parser';
import { ownExport, parseModule, starReexport } from './frameworks/bindings.ts';
import type { ModuleReader, ModuleSource } from './model.ts';
import { Values, type ImportReader, type Resolved, type Value } from './values.ts';

const UNRESOLVED: Resolved = { ok: false, importedFrom: null };

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
  private readonly pending = new Set<string>();

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
    // An import cycle that comes back to a name being worked out has no value yet.
    if (this.pending.has(key)) return UNRESOLVED;
    this.pending.add(key);
    const result = this.read(module, name);
    this.pending.delete(key);
    this.done.set(key, result);
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
    // `export *` passes on every name but the default; the first module that exports the name gives it.
    if (name === 'default') return null;
    for (const statement of program.body) {
      const source = starReexport(statement);
      const from = source === null ? null : module.readModule(source);
      const found = from && !('reason' in from) ? this.exported(from, name) : null;
      if (found) return found;
    }
    return null;
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
