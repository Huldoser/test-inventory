import type { Value } from './values.ts';

/** A line of TOML the reader doesn't take, with its line number. */
export class TomlError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

type Table = Record<string, Value>;

/**
 * A table without a prototype, so keys such as `__proto__` and `constructor` are its own, as in Bun, and a project's
 * `bunfig.toml` can't reach `Object.prototype`, which every later scan in the process would see.
 */
function newTable(): Table {
  return Object.create(null) as Table;
}

/**
 * The part of TOML a `bunfig.toml` uses: tables and dotted keys, strings, numbers, booleans, arrays over several lines,
 * inline tables and comments. Dates and arrays of tables are refused with a `TomlError`.
 */
export function readToml(text: string): Table {
  const root = newTable();
  let table = root;
  const reader = { text, at: 0, line: 1 };
  for (;;) {
    skipBlank(reader, true);
    if (reader.at >= text.length) return root;
    if (text[reader.at] === '[') {
      if (text[reader.at + 1] === '[') throw new TomlError('Arrays of tables are not read', reader.line);
      reader.at++;
      const keys = readKeys(reader, ']');
      reader.at++;
      table = tableAt(root, keys, reader.line);
    } else {
      const keys = readKeys(reader, '=');
      reader.at++;
      skipBlank(reader, false);
      const value = readValue(reader);
      const owner = tableAt(table, keys.slice(0, -1), reader.line);
      owner[keys[keys.length - 1]] = value;
    }
    skipBlank(reader, false);
    if (reader.at < text.length && text[reader.at] !== '\n') {
      throw new TomlError(`Unexpected "${text[reader.at]}"`, reader.line);
    }
  }
}

interface Reader {
  text: string;
  at: number;
  line: number;
}

/** Skips spaces and comments, and line breaks too when `lines` is set. */
function skipBlank(reader: Reader, lines: boolean): void {
  const { text } = reader;
  while (reader.at < text.length) {
    const char = text[reader.at];
    if (char === '#') {
      while (reader.at < text.length && text[reader.at] !== '\n') reader.at++;
    } else if (char === ' ' || char === '\t' || char === '\r') {
      reader.at++;
    } else if (char === '\n' && lines) {
      reader.line++;
      reader.at++;
    } else {
      return;
    }
  }
}

/** A dotted key, bare or quoted, up to `end`. */
function readKeys(reader: Reader, end: string): string[] {
  const keys: string[] = [];
  for (;;) {
    skipBlank(reader, false);
    const char = reader.text[reader.at];
    if (char === '"' || char === "'") keys.push(readString(reader));
    else {
      const bare = /^[A-Za-z0-9_-]+/.exec(reader.text.slice(reader.at));
      if (!bare) throw new TomlError('Expected a key', reader.line);
      keys.push(bare[0]);
      reader.at += bare[0].length;
    }
    skipBlank(reader, false);
    if (reader.text[reader.at] === end) return keys;
    if (reader.text[reader.at] !== '.') throw new TomlError(`Expected "${end}"`, reader.line);
    reader.at++;
  }
}

function tableAt(root: Table, keys: string[], line: number): Table {
  let table = root;
  for (const key of keys) {
    table[key] ??= newTable();
    const next = table[key];
    if (typeof next !== 'object' || Array.isArray(next)) {
      throw new TomlError(`${key} is not a table`, line);
    }
    table = next;
  }
  return table;
}

function readValue(reader: Reader): Value {
  const { text } = reader;
  const char = text[reader.at];
  if (char === '"' || char === "'") return readString(reader);
  if (char === '[') {
    reader.at++;
    const items: Value[] = [];
    for (;;) {
      skipBlank(reader, true);
      if (text[reader.at] === ']') break;
      items.push(readValue(reader));
      skipBlank(reader, true);
      if (text[reader.at] === ',') reader.at++;
      else if (text[reader.at] !== ']') throw new TomlError('Expected "," or "]"', reader.line);
    }
    reader.at++;
    return items;
  }
  if (char === '{') {
    reader.at++;
    const table = newTable();
    skipBlank(reader, false);
    while (text[reader.at] !== '}') {
      const keys = readKeys(reader, '=');
      reader.at++;
      skipBlank(reader, false);
      tableAt(table, keys.slice(0, -1), reader.line)[keys[keys.length - 1]] = readValue(reader);
      skipBlank(reader, false);
      if (text[reader.at] === ',') reader.at++;
      else if (text[reader.at] !== '}') throw new TomlError('Expected "," or "}"', reader.line);
      skipBlank(reader, false);
    }
    reader.at++;
    return table;
  }
  const word = /^[^\s,\]}#]+/.exec(text.slice(reader.at))?.[0] ?? '';
  reader.at += word.length;
  if (word === 'true' || word === 'false') return word === 'true';
  const number = word.replaceAll('_', '');
  if (/^[+-]?(\d+(\.\d+)?([eE][+-]?\d+)?|inf|nan)$/.test(number)) {
    return number.endsWith('inf') ? (number.startsWith('-') ? -Infinity : Infinity) : Number(number);
  }
  throw new TomlError(`Value ${word || text[reader.at]} is not read`, reader.line);
}

/** A basic string, with escapes, or a literal one; one line each. */
function readString(reader: Reader): string {
  const { text } = reader;
  const quote = text[reader.at++];
  let value = '';
  while (text[reader.at] !== quote) {
    const char = text[reader.at];
    if (reader.at >= text.length || char === '\n') throw new TomlError('The string is not closed', reader.line);
    if (char === '\\' && quote === '"') {
      const escape = text[reader.at + 1];
      const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };
      if (!(escape in escapes)) throw new TomlError(`Escape \\${escape} is not read`, reader.line);
      value += escapes[escape];
      reader.at += 2;
    } else {
      value += char;
      reader.at++;
    }
  }
  reader.at++;
  return value;
}
