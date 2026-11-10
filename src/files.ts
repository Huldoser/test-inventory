import { lstatSync, readdir, realpath, realpathSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import { fileDiagnostic } from './diagnostics.ts';
import { FRAMEWORK_NAMES } from './framework-version.ts';
import type { Diagnostic, Framework } from './types.ts';

const EXTENSIONS = /\.[cm]?[jt]sx?$/;

/** On Windows a `\` in a pattern is a path separator, as people type it there; elsewhere it escapes a character. */
export function normalizePattern(pattern: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? pattern.replaceAll('\\', '/') : pattern;
}

/** Why a file or folder could not be read, from the error's code; the message would hold the absolute path. */
export function readFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  const reasons: Record<string, string> = {
    EACCES: 'permission denied',
    EPERM: 'permission denied',
    ENOENT: 'it does not exist',
    EISDIR: 'it is a folder',
    EMFILE: 'too many files are open',
  };
  return code ? `${reasons[code] ?? 'error'} (${code})` : 'unknown error';
}

export interface FoundFile {
  absolutePath: string;
  relativeFilePath: string;
}

interface Failure {
  path: string;
  error: NodeJS.ErrnoException;
  kind: 'folder' | 'link';
}

type Callback<T> = (error: NodeJS.ErrnoException | null, value?: T) => void;

/** The glob's file system, which records the folders it could not open and the links that point nowhere. */
function recordingFs(failures: Failure[]) {
  return {
    readdir: ((folder: string, options: object, callback: Callback<unknown>) => {
      readdir(folder, options as never, (error: NodeJS.ErrnoException | null, entries: unknown) => {
        if (error) failures.push({ path: folder, error, kind: 'folder' });
        callback(error, entries);
      });
    }) as unknown as typeof readdir,
    realpath: ((link: string, callback: Callback<string>) => {
      realpath(link, (error, resolved) => {
        if (error) failures.push({ path: link, error, kind: 'link' });
        callback(error, resolved);
      });
    }) as unknown as typeof realpath,
  };
}

/** Runners that load a test file reached through a symbolic link; Playwright and Jest don't. */
const FOLLOWS_LINKS = new Set<Framework>(['vitest', 'mocha', 'jasmine', 'bun', 'node']);

/** Runners checked to leave such a file out; for the others, Cypress and WebdriverIO, it is not known. */
const IGNORES_LINKS = new Set<Framework>(['playwright', 'jest']);

/**
 * Whether a file is in a linked folder that no pattern names. `node --test` finds files with Node.js's glob, which
 * doesn't enter a linked folder through `*` or `**`, only where a pattern spells out its name.
 */
function inUnnamedLinkedFolder(root: string, match: string, patterns: string[]): boolean {
  const segments = match.split('/');
  for (let index = 0; index < segments.length - 1; index++) {
    if (!lstatSync(path.join(root, ...segments.slice(0, index + 1))).isSymbolicLink()) continue;
    if (!patterns.some((pattern) => namesFolder(pattern, segments, index))) return true;
  }
  return false;
}

/** Whether a pattern matches the file with the folder at `index` matched by a part that is its name, not a wildcard. */
function namesFolder(pattern: string, segments: string[], index: number): boolean {
  const parts = pattern.replace(/^\.\//, '').split('/');
  const matches = (glob: string[], items: string[]) => picomatch(glob.join('/'), { dot: true })(items.join('/'));
  return parts.some(
    (part, at) =>
      at < parts.length - 1 &&
      part === segments[index] &&
      !picomatch.scan(part).isGlob &&
      matches(parts.slice(0, at + 1), segments.slice(0, index + 1)) &&
      matches(parts.slice(at + 1), segments.slice(index + 1)),
  );
}

/**
 * Finds the test files, sorted so the output is the same on every run. Files reached through a symbolic link are
 * left out for runners that don't follow links, and read once for those that do, from the file's own path when it
 * matches too. Bun names such a file by its own path even when only the link matches, and node:test, which runs each
 * file in a process of its own, runs a file matched by both paths twice.
 */
export async function findFiles(
  root: string,
  patterns: string[],
  ignore: string[],
  framework: Framework,
  platform: NodeJS.Platform = process.platform,
): Promise<{ files: FoundFile[]; diagnostics: Diagnostic[] }> {
  const failures: Failure[] = [];
  const normalizedPatterns = patterns.map((pattern) => normalizePattern(pattern, platform));
  // Only files match; a folder named like a test file, such as a screenshot folder `checkout.spec.ts/`, is not expanded.
  // As in both runners, names that start with a dot match too, as in `.storybook/`.
  const matches = await glob(normalizedPatterns, {
    cwd: root,
    dot: true,
    ignore: ['**/node_modules/**', '**/.git/**', ...ignore.map((pattern) => normalizePattern(pattern, platform))],
    onlyFiles: true,
    expandDirectories: false,
    fs: recordingFs(failures),
  });
  const realRoot = realpathSync(root);
  const relative = (file: string) => path.relative(root, path.resolve(root, file)).replaceAll('\\', '/');
  const diagnostics: Diagnostic[] = [];
  for (const failure of failures) {
    const where = relative(failure.path);
    if (failure.kind === 'folder') {
      // A folder a pattern names that isn't there holds no tests; `no-files-matched` reports a scan that found none.
      if (failure.error.code === 'ENOENT' || failure.error.code === 'ENOTDIR') continue;
      const message = `The folder could not be read: ${readFailure(failure.error)}; test files in it are missing.`;
      diagnostics.push(fileDiagnostic('read-error', `${where}/`, message));
    } else if (EXTENSIONS.test(where)) {
      const message = `The file is a symbolic link to a file that could not be read: ${readFailure(failure.error)}.`;
      diagnostics.push(fileDiagnostic('read-error', where, message));
    }
  }
  const candidates: (FoundFile & { realPath: string; linked: boolean })[] = [];
  // The default sort compares UTF-16 code units, so the order is the same on every machine and locale.
  for (const match of matches.map((item) => item.replaceAll('\\', '/')).sort()) {
    if (!EXTENSIONS.test(match)) {
      diagnostics.push(
        fileDiagnostic('unsupported-file', match, 'The file is not JavaScript or TypeScript, so it was not read.'),
      );
      continue;
    }
    const absolutePath = path.resolve(root, match);
    const realPath = realpathSync(absolutePath);
    const linked = realPath !== path.join(realRoot, match);
    const name = FRAMEWORK_NAMES[framework];
    if (linked && !FOLLOWS_LINKS.has(framework)) {
      const message = IGNORES_LINKS.has(framework)
        ? `The file is reached through a symbolic link, which ${name} does not follow.`
        : `The file is reached through a symbolic link, which the scan does not follow for ${name}.`;
      diagnostics.push(fileDiagnostic('symlink-ignored', match, message));
      continue;
    }
    if (linked && framework === 'node' && inUnnamedLinkedFolder(root, match, normalizedPatterns)) {
      const message = `The file is in a linked folder, which a wildcard in a ${name} pattern does not enter.`;
      diagnostics.push(fileDiagnostic('symlink-ignored', match, message));
      continue;
    }
    const own = path.relative(realRoot, realPath).replaceAll('\\', '/');
    if (linked && framework === 'bun' && !own.startsWith('../') && !path.isAbsolute(own)) {
      candidates.push({ absolutePath: path.resolve(root, own), relativeFilePath: own, realPath, linked: false });
      continue;
    }
    candidates.push({ absolutePath, relativeFilePath: match, realPath, linked });
  }
  // Other runners read a file once; when both a link and the file itself match, the file's own path is the one kept.
  const kept = new Map<string, { linked: boolean }>();
  for (const candidate of candidates) {
    const current = kept.get(candidate.realPath);
    if (!current || (current.linked && !candidate.linked)) kept.set(candidate.realPath, candidate);
  }
  const files = candidates
    .filter((candidate) => framework === 'node' || kept.get(candidate.realPath) === candidate)
    .map(({ absolutePath, relativeFilePath }) => ({ absolutePath, relativeFilePath }));
  return { files, diagnostics };
}
