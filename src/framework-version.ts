import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Framework } from './types.ts';

const PACKAGES: Record<Framework, string> = { playwright: '@playwright/test', vitest: 'vitest' };

/** Oldest supported version of each framework. */
export const OLDEST: Record<Framework, [number, number]> = { playwright: [1, 42], vitest: [3, 0] };

/** Where the framework version came from. */
export interface DetectedVersion {
  version: string;
  /** The file it was read from, relative to the root. */
  source: string;
  /** Only a range is known, such as `^4.0.0`; `version` is its lowest version. */
  range: string | null;
}

/** A file's text, or null when it is missing or can't be read. */
function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file: string): unknown {
  const text = readText(file);
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The root, then each folder above it, as a monorepo package's dependencies may be installed or locked higher up. */
function folders(root: string): string[] {
  const list: string[] = [];
  for (let folder = path.resolve(root); ; folder = path.dirname(folder)) {
    list.push(folder);
    if (path.dirname(folder) === folder) return list;
  }
}

function installedVersion(folder: string, name: string): string | null {
  const manifest = readJson(path.join(folder, 'node_modules', name, 'package.json')) as { version?: unknown } | null;
  return typeof manifest?.version === 'string' ? manifest.version : null;
}

/** The version a lockfile in a folder records, and the lockfile's name. */
function lockedVersion(folder: string, name: string): { version: string; file: string } | null {
  const npm = readJson(path.join(folder, 'package-lock.json')) as {
    packages?: Record<string, { version?: string }>;
    dependencies?: Record<string, { version?: string }>;
  } | null;
  const fromNpm = npm?.packages?.[`node_modules/${name}`]?.version ?? npm?.dependencies?.[name]?.version;
  if (fromNpm) return { version: fromNpm, file: 'package-lock.json' };
  const pnpm = readText(path.join(folder, 'pnpm-lock.yaml'));
  const fromPnpm = pnpm && new RegExp(`^\\s+'?/?${escape(name)}@(\\d+\\.\\d+\\.\\d+[^:'(\\s]*)`, 'm').exec(pnpm);
  if (fromPnpm) return { version: fromPnpm[1], file: 'pnpm-lock.yaml' };
  const yarn = readText(path.join(folder, 'yarn.lock'));
  const fromYarn =
    yarn &&
    new RegExp(`^"?${escape(name)}@[^\\r\\n]*:\\r?\\n\\s+version:? "?(\\d+\\.\\d+\\.\\d+[^"\\s]*)`, 'm').exec(yarn);
  if (fromYarn) return { version: fromYarn[1], file: 'yarn.lock' };
  const bun = readText(path.join(folder, 'bun.lock'));
  const fromBun = bun && new RegExp(`"${escape(name)}": \\["${escape(name)}@(\\d+\\.\\d+\\.\\d+[^"]*)"`).exec(bun);
  return fromBun ? { version: fromBun[1], file: 'bun.lock' } : null;
}

/** The version a package.json in a folder declares: exact, or the lowest version of a range. */
function declaredVersion(folder: string, name: string): { version: string; range: string | null } | null {
  const manifest = readJson(path.join(folder, 'package.json')) as Record<
    string,
    Record<string, unknown> | undefined
  > | null;
  for (const field of ['devDependencies', 'dependencies', 'peerDependencies']) {
    const declared = manifest?.[field]?.[name];
    const lowest = typeof declared === 'string' ? /\d+\.\d+(\.\d+)?(-[0-9A-Za-z.-]+)?/.exec(declared) : null;
    if (typeof declared === 'string' && lowest) {
      const exact = /^=?v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(declared.trim());
      return { version: lowest[0], range: exact ? null : declared };
    }
  }
  return null;
}

/**
 * The framework version from the installed package, then a lockfile, then package.json, each looked for in the root
 * and the folders above it. A version range, as in `^4.0.0`, is used only when nothing else is found.
 */
export function detectFrameworkVersion(root: string, framework: Framework): DetectedVersion | null {
  const name = PACKAGES[framework];
  const source = (folder: string, file: string) => path.relative(root, path.join(folder, file)).replaceAll('\\', '/');
  const all = folders(root);
  for (const folder of all) {
    const version = installedVersion(folder, name);
    if (version) return { version, source: source(folder, `node_modules/${name}/package.json`), range: null };
  }
  for (const folder of all) {
    const locked = lockedVersion(folder, name);
    if (locked) return { version: locked.version, source: source(folder, locked.file), range: null };
  }
  for (const folder of all) {
    const declared = declaredVersion(folder, name);
    if (declared) return { ...declared, source: source(folder, 'package.json') };
  }
  return null;
}
