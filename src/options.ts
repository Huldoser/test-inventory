import type { CommentsMode } from './records.ts';
import type { Framework } from './types.ts';

export type { CommentsMode };

export interface ScanOptions {
  /** Glob patterns for the test files, relative to `root`. */
  patterns: string[];
  framework: Framework;
  /** The project root. Paths in the output are relative to it. Defaults to the current directory. */
  root?: string;
  /** Glob patterns to leave out, in addition to `node_modules`. */
  ignore?: string[];
  /** The framework version whose rules apply, instead of the one read from the project. */
  frameworkVersion?: string;
  /** Which tests get the comments above them. Defaults to `non-active`. */
  comments?: CommentsMode;
}

export interface ScanSourceOptions {
  code: string;
  /** Path of the file from the project root, used in the output and in ids. */
  relativeFilePath: string;
  framework: Framework;
  /** The framework version whose rules apply. The newest rules apply when it is missing. */
  frameworkVersion?: string | null;
  /** Which tests get the comments above them. Defaults to `non-active`. */
  comments?: CommentsMode;
}

const FRAMEWORKS: readonly Framework[] = ['playwright', 'vitest'];
const COMMENTS: readonly CommentsMode[] = ['all', 'non-active', 'none'];
// A prerelease and build metadata each appear once, so a long input can't make the match backtrack for long.
const VERSION = /^v?(\d+)\.(\d+)(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** An invalid option, told apart from other errors so that the command line can show it as a usage error. */
export class OptionsError extends TypeError {}

export function invalid(option: string, expected: string): OptionsError {
  return new OptionsError(`${option} must be ${expected}.`);
}

export function checkObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(name, 'an object');
  return value as Record<string, unknown>;
}

export function checkFramework(value: unknown, option: string): Framework {
  if (!FRAMEWORKS.includes(value as Framework)) throw invalid(option, '"playwright" or "vitest"');
  return value as Framework;
}

export function checkComments(value: unknown, option: string): CommentsMode {
  if (value === undefined) return 'non-active';
  if (!COMMENTS.includes(value as CommentsMode)) throw invalid(option, '"all", "non-active" or "none"');
  return value as CommentsMode;
}

export function checkVersion(value: unknown, option: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !VERSION.test(value)) throw invalid(option, 'a version such as "1.63.0"');
  return value.replace(/^v/, '');
}

export function checkString(value: unknown, option: string): string {
  if (typeof value !== 'string' || value === '') throw invalid(option, 'a non-empty string');
  return value;
}

export function checkStrings(value: unknown, option: string, required: boolean): string[] {
  if (value === undefined && !required) return [];
  if (
    !Array.isArray(value) ||
    (required && value.length === 0) ||
    !value.every((item) => typeof item === 'string' && item !== '')
  ) {
    throw invalid(option, required ? 'a non-empty array of glob patterns' : 'an array of glob patterns');
  }
  return value as string[];
}

/** `[major, minor]` of a checked version, or null. */
export function majorMinor(version: string | null): [number, number] | null {
  const match = version === null ? null : VERSION.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** A path with `/` separators and without a leading `./`. */
export function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
}
