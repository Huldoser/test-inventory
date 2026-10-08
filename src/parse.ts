import { parseSync, type OxcError, type ParserOptions, type Program } from 'oxc-parser';
import { SourceText } from './source.ts';

export interface ParsedFile {
  source: SourceText;
  program: Program;
  comments: { type: 'Line' | 'Block'; value: string; start: number; end: number }[];
  error: { message: string; start: number; end: number } | null;
}

function parserOptions(fileName: string): ParserOptions {
  const extension = /\.[cm]?[jt]sx?$/.exec(fileName)?.[0] ?? '.ts';
  // Plain JavaScript files may contain JSX, as test files for components often do.
  const lang = extension.includes('t') ? (extension === '.tsx' ? 'tsx' : 'ts') : 'jsx';
  const sourceType = extension.startsWith('.c') ? 'commonjs' : extension.startsWith('.m') ? 'module' : 'unambiguous';
  return { lang, sourceType, preserveParens: false };
}

/** The first parser error, located at its first label, or at the start of the file when it has none. */
export function firstError(errors: readonly OxcError[]): ParsedFile['error'] {
  const first = errors.at(0);
  if (!first) return null;
  const label = first.labels.at(0);
  return { message: first.message, start: label?.start ?? 0, end: label?.end ?? 0 };
}

export function parseFile(fileName: string, code: string): ParsedFile {
  // A byte order mark is not part of the code, and editors don't count it as a column.
  const text = code.charCodeAt(0) === 0xfeff ? code.slice(1) : code;
  const result = parseSync(fileName, text, parserOptions(fileName));
  return {
    source: new SourceText(text),
    program: result.program,
    comments: result.comments,
    error: firstError(result.errors),
  };
}
