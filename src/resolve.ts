import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
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
}

/** `paths` and `baseUrl` from the root tsconfig.json, with the ones of the file it extends, one level deep. */
function tsconfigPaths(root: string): PathOptions {
  const options: PathOptions = { paths: null, pathsBase: root, baseUrl: null };
  const file = path.join(root, 'tsconfig.json');
  const config = readJson(file);
  if (!config) return options;
  const extended = (Array.isArray(config.extends) ? config.extends : [config.extends]).filter(
    (item): item is string => typeof item === 'string' && item.startsWith('.'),
  );
  const layers = [
    ...extended.map((item) => {
      const parent = path.resolve(root, item.endsWith('.json') ? item : `${item}.json`);
      return { directory: path.dirname(parent), config: readJson(parent) };
    }),
    { directory: root, config },
  ];
  // Later layers override earlier ones, as `extends` does.
  for (const layer of layers) {
    const compilerOptions = record(layer.config?.compilerOptions);
    if (typeof compilerOptions?.baseUrl === 'string') {
      options.baseUrl = path.resolve(layer.directory, compilerOptions.baseUrl);
    }
    const paths = record(compilerOptions?.paths);
    if (paths) {
      options.paths = paths;
      options.pathsBase = layer.directory;
    }
  }
  if (options.baseUrl) options.pathsBase = options.baseUrl;
  return options;
}

/** Files a path alias stands for in tsconfig `paths`; null when no pattern matches. */
function aliasFiles(specifier: string, options: PathOptions): string[] | null {
  const match = options.paths ? matchPattern(Object.keys(options.paths), specifier) : null;
  if (!match || !options.paths) return null;
  return targetStrings(options.paths[match.key]).map((target) =>
    path.resolve(options.pathsBase, target.replace('*', match.star)),
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

/** A package linked from the workspace into node_modules, followed to its TypeScript source. */
function workspaceSource(specifier: string, directory: string): { file: string } | { reason: string } | null {
  const parts = specifier.split('/');
  const nameLength = specifier.startsWith('@') ? 2 : 1;
  const name = parts.slice(0, nameLength).join('/');
  const subpath = ['.', ...parts.slice(nameLength)].join('/');
  for (let folder = directory; ; folder = path.dirname(folder)) {
    const linked = path.join(folder, 'node_modules', name);
    if (existsSync(linked)) {
      const real = realpathSync(linked);
      if (real.split(path.sep).includes('node_modules')) {
        return { reason: 'is an installed package, which is not followed' };
      }
      const manifest = readJson(path.join(real, 'package.json'));
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
      const file = targets
        .filter((target) => TYPESCRIPT_SOURCE.test(target))
        .map((target) => path.resolve(real, target))
        .find(isFile);
      return file
        ? { file }
        : { reason: "is a workspace package whose exports, types and main don't point to TypeScript source" };
    }
    if (path.dirname(folder) === folder) return null;
  }
}

/**
 * Returns a reader for the modules a test file imports. It follows relative paths, tsconfig `paths` and `baseUrl`,
 * package.json `imports` (`#name`), and workspace packages linked into node_modules whose entry is TypeScript source.
 */
export function moduleResolver(root: string): (fromFile: string) => ModuleReader {
  let options: PathOptions | null = null;
  // Many test files import the same fixtures file; it is read once, and parsed once by the code that follows it.
  const modules = new Map<string, ModuleSource | null>();
  return (fromFile) => (specifier) => {
    const directory = path.dirname(fromFile);
    let candidates: string[];
    // `.` and `..` are paths too: the index of the file's folder, or of the folder above.
    if (/^\.\.?(?:\/|$)/.test(specifier)) {
      candidates = [path.resolve(directory, specifier)];
    } else if (specifier.startsWith('#')) {
      candidates = subpathImportFiles(specifier, directory);
      if (candidates.length === 0) return { reason: 'is not in the imports of package.json' };
    } else {
      options ??= tsconfigPaths(root);
      const aliased = aliasFiles(specifier, options);
      if (aliased) {
        candidates = aliased;
      } else {
        // `baseUrl` turns any name into a path, so a name not found there may still be a workspace package.
        const fromBaseUrl = options.baseUrl ? findFile(path.resolve(options.baseUrl, specifier)) : null;
        const workspace = fromBaseUrl ? null : workspaceSource(specifier, directory);
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
        code === null ? null : { code, relativeFilePath: path.relative(root, found).replaceAll('\\', '/') },
      );
    }
    return modules.get(found) ?? { reason: 'could not be read' };
  };
}
