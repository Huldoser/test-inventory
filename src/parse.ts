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

/**
 * How deep brackets may nest. oxc-parser recurses on the native stack, which no catch can stop: brackets about 2,400
 * deep crash a worker thread's 4 MB stack and 4,800 the main thread's 8 MB. Of the 10,000 files in this package's
 * development dependencies, minified bundles included, the deepest nests 34.
 */
const MAX_NESTING = 500;

/** Words after which a `/` starts a regular expression rather than a division. */
const BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

const Char = {
  Tab: 9,
  LineFeed: 10,
  CarriageReturn: 13,
  Space: 32,
  DoubleQuote: 34,
  Dollar: 36,
  SingleQuote: 39,
  OpenParen: 40,
  CloseParen: 41,
  Star: 42,
  Slash: 47,
  LessThan: 60,
  GreaterThan: 62,
  OpenBracket: 91,
  Backslash: 92,
  CloseBracket: 93,
  Backtick: 96,
  OpenBrace: 123,
  CloseBrace: 125,
} as const;

/** Letters, digits, `_`, `$` and anything outside ASCII, as identifiers and numbers use. */
function isWordChar(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === Char.Dollar ||
    code > 127
  );
}

/** Whether the code right before `end` is a word after which a `/` starts a regular expression. */
function afterKeyword(text: string, end: number): boolean {
  let wordEnd = end;
  while (wordEnd > 0 && /\s/.test(text[wordEnd - 1])) wordEnd--;
  let wordStart = wordEnd;
  while (wordStart > 0 && isWordChar(text.charCodeAt(wordStart - 1))) wordStart--;
  return BEFORE_REGEX.has(text.slice(wordStart, wordEnd));
}

/**
 * Whether the slash at `at` ends a JSX tag, as in `</ul>` or `<OrderLeg leg={leg} />`, where a regular expression
 * could otherwise start and run on over the brackets after it.
 */
function endsJsxTag(text: string, at: number): boolean {
  if (text.charCodeAt(at - 1) === Char.LessThan) return true;
  if (text.charCodeAt(at + 1) !== Char.GreaterThan) return false;
  let before = at - 1;
  while (before > 0 && /\s/.test(text[before])) before--;
  return text.charCodeAt(before) === Char.CloseBrace;
}

/**
 * The offset of the first bracket nested more than `limit` deep, or null. Parentheses, brackets, braces and template
 * substitutions count; strings, comments, regular expressions and template text are skipped. A closing bracket closes
 * up to the one it matches, so a literal read wrongly unbalances only the brackets around it.
 */
export function tooDeeplyNested(text: string, limit: number): number | null {
  // Open brackets by their character; a substitution is kept as its backtick.
  const open: number[] = [];
  const counts = new Uint32Array(128);
  let regexAllowed = true;
  let index = 0;
  const push = (code: number): boolean => {
    open.push(code);
    counts[code]++;
    return open.length > limit;
  };
  // Reads template text up to its end or a substitution; true when the substitution is one too deep.
  const templateText = (): boolean => {
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === Char.Backslash) index += 2;
      else if (code === Char.Backtick) {
        index++;
        regexAllowed = false;
        return false;
      } else if (code === Char.Dollar && text.charCodeAt(index + 1) === Char.OpenBrace) {
        if (push(Char.Backtick)) return true;
        index += 2;
        regexAllowed = true;
        return false;
      } else index++;
    }
    return false;
  };
  // Skips a string or regular expression; neither goes past the end of the line.
  const literal = (end: number): void => {
    let inClass = false;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === Char.LineFeed) return;
      index += code === Char.Backslash ? 2 : 1;
      if (end === Char.Slash && code === Char.OpenBracket) inClass = true;
      else if (code === Char.CloseBracket) inClass = false;
      else if (code === end && !inClass) return;
    }
  };
  while (index < text.length) {
    const code = text.charCodeAt(index);
    const next = text.charCodeAt(index + 1);
    const start = index;
    if (code === Char.Space || code === Char.LineFeed || code === Char.Tab || code === Char.CarriageReturn) {
      index++;
    } else if (code === Char.Slash && next === Char.Slash) {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end;
    } else if (code === Char.Slash && next === Char.Star) {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
    } else if (
      code === Char.SingleQuote ||
      code === Char.DoubleQuote ||
      (code === Char.Slash && (regexAllowed || afterKeyword(text, start)) && !endsJsxTag(text, start))
    ) {
      index++;
      literal(code);
      regexAllowed = false;
    } else if (code === Char.Backtick) {
      index++;
      if (templateText()) return index;
    } else if (isWordChar(code)) {
      while (index < text.length && isWordChar(text.charCodeAt(index))) index++;
      regexAllowed = false;
    } else if (code === Char.OpenParen || code === Char.OpenBracket || code === Char.OpenBrace) {
      if (push(code)) return start;
      index++;
      regexAllowed = true;
    } else if (code === Char.CloseParen || code === Char.CloseBracket || code === Char.CloseBrace) {
      index++;
      // A block can end right before a regular expression; a value in parentheses or brackets is divided.
      regexAllowed = code === Char.CloseBrace;
      const opener =
        code === Char.CloseParen ? Char.OpenParen : code === Char.CloseBracket ? Char.OpenBracket : Char.OpenBrace;
      const closesSubstitution = code === Char.CloseBrace && counts[Char.Backtick] !== 0;
      if (counts[opener] === 0 && !closesSubstitution) continue;
      let closed: number;
      do {
        closed = open.pop() as number;
        counts[closed]--;
      } while (closed !== opener && !(closed === Char.Backtick && code === Char.CloseBrace));
      // A substitution after this one is as deep as the one it closed, so it is never the first too deep.
      if (closed === Char.Backtick) templateText();
    } else {
      index++;
      regexAllowed = true;
    }
  }
  return null;
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
  const tooDeep = tooDeeplyNested(text, MAX_NESTING);
  if (tooDeep !== null) {
    const message = `Brackets are nested more than ${MAX_NESTING} deep, too deep to parse safely`;
    return {
      source: new SourceText(text),
      program: parseSync(fileName, '', parserOptions(fileName)).program,
      comments: [],
      error: { message, start: tooDeep, end: tooDeep + 1 },
    };
  }
  const result = parseSync(fileName, text, parserOptions(fileName));
  return {
    source: new SourceText(text),
    program: result.program,
    comments: result.comments,
    error: firstError(result.errors),
  };
}
