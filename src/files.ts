import { readdir, realpath, realpathSync } from 'node:fs';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { fileDiagnostic } from './diagnostics.ts';
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

/**
 * Finds the test files, sorted so the output is the same on every run. Files reached through a symbolic link are
 * left out for Playwright, which doesn't follow them, and read once for Vitest, which does, from the file's own path
 * when it matches too.
 */
export async function findFiles(
  root: string,
  patterns: string[],
  ignore: string[],
  framework: Framework,
): Promise<{ files: FoundFile[]; diagnostics: Diagnostic[] }> {
  const failures: Failure[] = [];
  // Only files match; a folder named like a test file, such as a screenshot folder `checkout.spec.ts/`, is not expanded.
  const matches = await glob(
    patterns.map((pattern) => normalizePattern(pattern)),
    {
      cwd: root,
      ignore: ['**/node_modules/**', ...ignore.map((pattern) => normalizePattern(pattern))],
      onlyFiles: true,
      expandDirectories: false,
      fs: recordingFs(failures),
    },
  );
  const realRoot = realpathSync(root);
  const relative = (file: string) => path.relative(root, path.resolve(root, file)).replaceAll('\\', '/');
  const diagnostics: Diagnostic[] = [];
  for (const failure of failures) {
    const where = relative(failure.path);
    if (failure.kind === 'folder') {
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
    if (linked && framework === 'playwright') {
      diagnostics.push(
        fileDiagnostic(
          'symlink-ignored',
          match,
          'The file is reached through a symbolic link, which Playwright does not follow.',
        ),
      );
      continue;
    }
    candidates.push({ absolutePath, relativeFilePath: match, realPath, linked });
  }
  // Vitest reads a file once; when both a link and the file itself match, the file's own path is the one kept.
  const kept = new Map<string, { linked: boolean }>();
  for (const candidate of candidates) {
    const current = kept.get(candidate.realPath);
    if (!current || (current.linked && !candidate.linked)) kept.set(candidate.realPath, candidate);
  }
  const files = candidates
    .filter((candidate) => kept.get(candidate.realPath) === candidate)
    .map(({ absolutePath, relativeFilePath }) => ({ absolutePath, relativeFilePath }));
  return { files, diagnostics };
}
