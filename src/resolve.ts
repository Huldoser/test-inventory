import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'tinyglobby';
import type { ModuleReader, ModuleSource } from './model.ts';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const TYPESCRIPT_SOURCE = /(?<!\.d)\.[cm]?tsx?$/;

function isFile(file: string): boolean {
  return existsSync(file) && statSync(file).isFile();
}

/** The file a path refers to, found the way TypeScript and Node do: as is, with an extension, or a folder's index. */
function findFile(base: string): string | null {
  const stripped = base.replace(/\.[cm]?js$/, '');
  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => stripped + extension),
    ...EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find(isFile) ?? null;
}

/** Parses JSON written with comments and trailing commas, as tsconfig files often are; null when it isn't JSON. */
export function parseJsonc(text: string): unknown {
  // Strings are matched first, so that `//` or `,}` inside a string stays as it is.
  const withoutComments = text.replace(
    /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_, string?: string) => string ?? '',
  );
  const withoutTrailingCommas = withoutComments.replace(
    /("(?:[^"\\]|\\.)*")|,(?=\s*[}\]])/g,
    (_, string?: string) => string ?? '',
  );
  try {
    return JSON.parse(withoutTrailingCommas) as unknown;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A file's text, or null when it is missing or can't be read. */
function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file: string): Record<string, unknown> | null {
  const text = isFile(file) ? readText(file) : null;
  return text === null ? null : record(parseJsonc(text));
}

/** The pattern of a map such as tsconfig `paths` or package.json `imports` that a specifier matches, TypeScript's way. */
function matchPattern(keys: string[], specifier: string): { key: string; star: string } | null {
  if (keys.includes(specifier)) return { key: specifier, star: '' };
  let best: { key: string; star: string } | null = null;
  for (const key of keys) {
    const parts = key.split('*');
    if (parts.length !== 2) continue;
    const [prefix, suffix] = parts;
    if (
      specifier.length < prefix.length + suffix.length ||
      !specifier.startsWith(prefix) ||
      !specifier.endsWith(suffix)
    ) {
      continue;
    }
    // The longest prefix wins.
    if (best === null || prefix.length > best.key.indexOf('*')) {
      best = { key, star: specifier.slice(prefix.length, specifier.length - suffix.length) };
    }
  }
  return best;
}

/** Every string in a package.json target, in order: a string, an array of targets, or an object of conditions. */
function targetStrings(target: unknown): string[] {
  if (typeof target === 'string') return [target];
  if (Array.isArray(target)) return target.flatMap(targetStrings);
  const conditions = record(target);
  return conditions ? Object.values(conditions).flatMap(targetStrings) : [];
}

interface PathOptions {
  paths: Record<string, unknown> | null;
  /** The folder `paths` are relative to: `baseUrl`, or the folder of the tsconfig that sets `paths`. */
  pathsBase: string;
  baseUrl: string | null;
  /** The folder of the tsconfig the options were read for, which `${configDir}` in a value stands for. */
  configDir: string;
}

/** A package name and the subpath after it, as in `@trading/test-utils` and `./fixtures`; `.` when there is none. */
function packageName(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split('/');
  const nameLength = specifier.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, nameLength).join('/'), subpath: ['.', ...parts.slice(nameLength)].join('/') };
}

/** The file a path names, with `.json` added when it has no extension and doesn't exist as written, as in `extends`. */
function jsonFile(file: string): string | null {
  if (isFile(file)) return file;
  return !file.endsWith('.json') && isFile(`${file}.json`) ? `${file}.json` : null;
}

/** The file a tsconfig `extends` entry names: a path, or a package found in node_modules as TypeScript finds it. */
function extendedFile(entry: string, directory: string): string | null {
  if (entry.startsWith('.') || path.isAbsolute(entry)) return jsonFile(path.resolve(directory, entry));
  const { name, subpath } = packageName(entry);
  for (let folder = directory; ; folder = path.dirname(folder)) {
    const packageFolder = path.join(folder, 'node_modules', name);
    if (existsSync(packageFolder)) {
      if (subpath !== '.') return jsonFile(path.join(packageFolder, subpath));
      const field = readJson(path.join(packageFolder, 'package.json'))?.tsconfig;
      return jsonFile(path.join(packageFolder, typeof field === 'string' ? field : 'tsconfig.json'));
    }
    if (path.dirname(folder) === folder) return null;
  }
}

/** A tsconfig and every file it extends, the furthest base first, in the order TypeScript applies them. */
function tsconfigLayers(
  file: string,
  seen = new Set<string>(),
): { directory: string; config: Record<string, unknown> }[] {
  const config = seen.has(file) ? null : readJson(file);
  if (!config) return [];
  seen.add(file);
  const directory = path.dirname(file);
  const entries = (Array.isArray(config.extends) ? config.extends : [config.extends]).filter(
    (item): item is string => typeof item === 'string',
  );
  const bases = entries.flatMap((entry) => {
    const base = extendedFile(entry, directory);
    return base ? tsconfigLayers(base, seen) : [];
  });
  return [...bases, { directory, config }];
}

/**
 * `paths` and `baseUrl` from a tsconfig and the files it extends, later files overriding earlier ones. A solution-style
 * tsconfig without them, as Vite projects have, takes them from the first project in its `references` that sets them.
 */
function tsconfigPaths(file: string, seen = new Set<string>()): PathOptions {
  seen.add(file);
  const configDir = path.dirname(file);
  const options: PathOptions = { paths: null, pathsBase: configDir, baseUrl: null, configDir };
  const layers = tsconfigLayers(file);
  for (const layer of layers) {
    const compilerOptions = record(layer.config.compilerOptions);
    if (typeof compilerOptions?.baseUrl === 'string') {
      options.baseUrl = path.resolve(layer.directory, compilerOptions.baseUrl.replaceAll('${configDir}', configDir));
    }
    const paths = record(compilerOptions?.paths);
    if (paths) {
      options.paths = paths;
      options.pathsBase = layer.directory;
    }
  }
  if (options.baseUrl) {
    options.pathsBase = options.baseUrl;
  } else if (!options.paths) {
    const references = layers.at(-1)?.config.references;
    for (const reference of Array.isArray(references) ? references : []) {
      const target = record(reference)?.path;
      if (typeof target !== 'string') continue;
      const referenced = path.resolve(configDir, target);
      const referencedFile = target.endsWith('.json') ? referenced : path.join(referenced, 'tsconfig.json');
      // Projects may reference each other; each tsconfig is read once.
      const found = isFile(referencedFile) && !seen.has(referencedFile) ? tsconfigPaths(referencedFile, seen) : null;
      if (found && (found.paths ?? found.baseUrl)) return found;
    }
  }
  return options;
}

/**
 * The tsconfig TypeScript uses for a file in the folder: the nearest tsconfig.json above it. Without one, the nearest
 * tsconfig.base.json, which holds the path aliases of an Nx workspace.
 */
function nearestTsconfig(directory: string): string | null {
  let base: string | null = null;
  for (let folder = directory; ; folder = path.dirname(folder)) {
    const file = path.join(folder, 'tsconfig.json');
    if (isFile(file)) return file;
    const baseFile = path.join(folder, 'tsconfig.base.json');
    base ??= isFile(baseFile) ? baseFile : null;
    if (path.dirname(folder) === folder) return base;
  }
}

/** Files a path alias stands for in tsconfig `paths`; null when no pattern matches. */
function aliasFiles(specifier: string, options: PathOptions): string[] | null {
  const match = options.paths ? matchPattern(Object.keys(options.paths), specifier) : null;
  if (!match || !options.paths) return null;
  return targetStrings(options.paths[match.key]).map((target) =>
    path.resolve(options.pathsBase, target.replaceAll('${configDir}', options.configDir).replace('*', match.star)),
  );
}

/** Files a `#name` import may stand for, from `imports` in the nearest package.json. */
function subpathImportFiles(specifier: string, directory: string): string[] {
  for (let folder = directory; ; folder = path.dirname(folder)) {
    const manifest = readJson(path.join(folder, 'package.json'));
    const imports = record(manifest?.imports);
    if (manifest) {
      const match = imports ? matchPattern(Object.keys(imports), specifier) : null;
      if (!match || !imports) return [];
      return targetStrings(imports[match.key]).map((target) => path.resolve(folder, target.replace('*', match.star)));
    }
    if (path.dirname(folder) === folder) return [];
  }
}

const BUILD_FOLDERS = new Set(['dist', 'build', 'lib', 'out']);
const FORMAT_FOLDERS = new Set(['esm', 'cjs', 'es', 'mjs', 'umd', 'types']);

/**
 * Where the TypeScript source of a built file usually is, for a workspace package that hasn't been built: both
 * `dist/esm/index.js` and `dist/types/index.d.ts` come from `src/index.ts`.
 */
function sourceOf(target: string): string[] {
  const parts = target.replace(/^\.\//, '').split('/');
  if (parts.length < 2 || !BUILD_FOLDERS.has(parts[0])) return [];
  const rest = parts.length > 2 && FORMAT_FOLDERS.has(parts[1]) ? parts.slice(2) : parts.slice(1);
  const base = ['src', ...rest].join('/').replace(/(\.d)?\.[cm]?[jt]sx?$/, '');
  return [`${base}.ts`, `${base}.tsx`];
}

/**
 * The TypeScript source a package's exports, types or main point to for a subpath such as `.` or `./fixtures`. When they
 * point to build output, the source next to it is used, as in a workspace package that hasn't been built.
 */
function packageEntry(folder: string, subpath: string): { file: string } | { reason: string } {
  const manifest = readJson(path.join(folder, 'package.json'));
  const exports = manifest?.exports;
  const map = record(exports);
  const isSubpathMap = map !== null && Object.keys(map).some((key) => key.startsWith('.'));
  let targets: string[];
  if (isSubpathMap) {
    const match = matchPattern(Object.keys(map), subpath);
    targets = match ? targetStrings(map[match.key]).map((target) => target.replace('*', match.star)) : [];
  } else {
    targets = subpath === '.' ? targetStrings(exports) : [];
  }
  if (subpath === '.') targets.push(...targetStrings(manifest?.types), ...targetStrings(manifest?.main));
  const file = [...targets.filter((target) => TYPESCRIPT_SOURCE.test(target)), ...targets.flatMap(sourceOf)]
    .map((target) => path.resolve(folder, target))
    .find(isFile);
  return file
    ? { file }
    : { reason: "is a workspace package whose exports, types and main don't point to TypeScript source" };
}

/**
 * The `packages` list of a pnpm-workspace.yaml, as a block list or a flow list. The file holds little more than this
 * list, so it is read line by line rather than with a YAML parser.
 */
function pnpmWorkspacePatterns(text: string): string[] {
  const unquote = (item: string) => item.trim().replace(/^(['"])(.*)\1$/, '$2');
  const flow = /^packages:\s*\[(.*)\]/m.exec(text);
  if (flow) return flow[1].split(',').map(unquote).filter(Boolean);
  const patterns: string[] = [];
  let inList = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*(#.*)?$/.test(line)) {
      inList = true;
      continue;
    }
    const item = inList ? /^\s+-\s*([^#]+)/.exec(line) : null;
    if (item) patterns.push(unquote(item[1]));
    else if (inList && line.trim() !== '' && !line.trim().startsWith('#')) inList = false;
  }
  return patterns;
}

/** The folder of each package in the workspace a folder belongs to, by name; empty outside a workspace. */
function workspacePackages(directory: string): Map<string, string> {
  for (let folder = directory; ; folder = path.dirname(folder)) {
    const workspaces = readJson(path.join(folder, 'package.json'))?.workspaces;
    const fromManifest = Array.isArray(workspaces) ? workspaces : record(workspaces)?.packages;
    const pnpm = readText(path.join(folder, 'pnpm-workspace.yaml'));
    const patterns = (Array.isArray(fromManifest) ? fromManifest : pnpm ? pnpmWorkspacePatterns(pnpm) : null)?.filter(
      (item): item is string => typeof item === 'string',
    );
    if (patterns) {
      // Packages are inside the workspace. A pattern or a link that leads out of its folder could send the search through
      // the whole disk, so neither is followed.
      const inside = patterns.filter(
        (item) => !path.isAbsolute(item.replace(/^!/, '')) && !/(^|\/)\.\.(\/|$)/.test(item),
      );
      const manifests = globSync(
        inside.filter((item) => !item.startsWith('!')).map((item) => `${item.replace(/\/+$/, '')}/package.json`),
        {
          cwd: folder,
          absolute: true,
          followSymbolicLinks: false,
          ignore: ['**/node_modules/**', ...inside.filter((item) => item.startsWith('!')).map((item) => item.slice(1))],
        },
      );
      const packages = new Map<string, string>();
      for (const manifest of manifests) {
        const name = readJson(manifest)?.name;
        if (typeof name === 'string') packages.set(name, path.dirname(manifest));
      }
      return packages;
    }
    if (path.dirname(folder) === folder) return new Map();
  }
}

/**
 * A workspace package followed to its TypeScript source: through its link in node_modules, or, before an install, from
 * the packages the workspace lists. A package installed from a registry is not followed.
 */
function workspaceSource(
  specifier: string,
  directory: string,
  packagesOf: (directory: string) => Map<string, string>,
): { file: string } | { reason: string } | null {
  const { name, subpath } = packageName(specifier);
  for (let folder = directory; ; folder = path.dirname(folder)) {
    const linked = path.join(folder, 'node_modules', name);
    if (existsSync(linked)) {
      const real = realpathSync(linked);
      if (real.split(path.sep).includes('node_modules')) {
        return { reason: 'is an installed package, which is not followed' };
      }
      return packageEntry(real, subpath);
    }
    if (path.dirname(folder) === folder) break;
  }
  const local = packagesOf(directory).get(name);
  return local ? packageEntry(local, subpath) : null;
}

/**
 * Returns a reader for the modules a test file imports. It follows relative paths, tsconfig `paths` and `baseUrl` from
 * the tsconfig nearest the importing file, package.json `imports` (`#name`), and workspace packages whose entry is
 * TypeScript source. Each module it reads carries a reader for the modules that module imports in turn.
 */
export function moduleResolver(root: string): (fromFile: string) => ModuleReader {
  // Many test files import the same fixtures file and share a tsconfig; each is read once.
  const modules = new Map<string, ModuleSource | null>();
  const tsconfigs = new Map<string, string | null>();
  const pathOptions = new Map<string, PathOptions>();
  const workspaces = new Map<string, Map<string, string>>();
  const optionsFor = (directory: string): PathOptions | null => {
    if (!tsconfigs.has(directory)) tsconfigs.set(directory, nearestTsconfig(directory));
    const file = tsconfigs.get(directory);
    if (!file) return null;
    let options = pathOptions.get(file);
    if (!options) {
      options = tsconfigPaths(file);
      pathOptions.set(file, options);
    }
    return options;
  };
  const packagesOf = (directory: string): Map<string, string> => {
    let packages = workspaces.get(directory);
    if (!packages) {
      packages = workspacePackages(directory);
      workspaces.set(directory, packages);
    }
    return packages;
  };
  const reader =
    (fromFile: string): ModuleReader =>
    (specifier) => {
      const directory = path.dirname(fromFile);
      let candidates: string[];
      // `.` and `..` are paths too: the index of the file's folder, or of the folder above.
      if (/^\.\.?(?:\/|$)/.test(specifier)) {
        candidates = [path.resolve(directory, specifier)];
      } else if (specifier.startsWith('#')) {
        candidates = subpathImportFiles(specifier, directory);
        if (candidates.length === 0) return { reason: 'is not in the imports of package.json' };
      } else {
        const options = optionsFor(directory);
        const aliased = options ? aliasFiles(specifier, options) : null;
        if (aliased) {
          candidates = aliased;
        } else {
          // `baseUrl` turns any name into a path, so a name not found there may still be a workspace package.
          const fromBaseUrl = options?.baseUrl ? findFile(path.resolve(options.baseUrl, specifier)) : null;
          const workspace = fromBaseUrl ? null : workspaceSource(specifier, directory, packagesOf);
          if (workspace && 'reason' in workspace) return workspace;
          const file = fromBaseUrl ?? workspace?.file;
          if (!file) return { reason: 'is not a local file, a path alias or a workspace package' };
          candidates = [file];
        }
      }
      const found = candidates.map(findFile).find((file) => file !== null);
      if (!found) return { reason: 'could not be read' };
      if (!modules.has(found)) {
        const code = readText(found);
        modules.set(
          found,
          code === null
            ? null
            : { code, relativeFilePath: path.relative(root, found).replaceAll('\\', '/'), readModule: reader(found) },
        );
      }
      return modules.get(found) ?? { reason: 'could not be read' };
    };
  return reader;
}
