import type { Value } from './values.ts';

/** Where a YAML text uses something `readYaml` doesn't read, with its 1-based line. */
export class YamlError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

interface Line {
  number: number;
  indent: number;
  text: string;
}

/**
 * The value of a YAML config as Mocha's `.mocharc.yml` files write it: a map of keys to scalars, to lists written one
 * item per line or in brackets, and to maps of those. Anchors, multi-line strings, flow maps and documents after the
 * first are refused with a `YamlError`, as a guess at them could read the wrong test files, and so is what js-yaml,
 * Mocha's reader, refuses: a key set twice, a tab in the indent, or `: ` in a plain value.
 */
export function readYaml(text: string): Value {
  const lines: Line[] = [];
  let ended = false;
  text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const content = withoutComment(raw);
      const trimmed = content.trim();
      if (trimmed === '') return;
      const number = index + 1;
      // Directives and the `---` that starts the document come before its content, and `...` ends it.
      if (lines.length === 0 && !ended && (trimmed === '---' || trimmed.startsWith('%'))) return;
      if (ended || trimmed === '---') throw new YamlError('documents after the first are not read', number);
      if (trimmed === '...') {
        ended = true;
        return;
      }
      const indent = content.slice(0, content.length - content.trimStart().length);
      if (indent.includes('\t')) throw new YamlError('the line is indented with a tab, which YAML refuses', number);
      lines.push({ number, indent: indent.length, text: trimmed });
    });
  if (lines.length === 0) return {};
  const [value, next] = block(lines, 0, lines[0].indent);
  if (next < lines.length) throw new YamlError('a line is indented less than the one it continues', lines[next].number);
  return value;
}

/** Whether a line is a list item: a `-` alone or before a space, as `-a.js` is a plain value. */
function isItem(text: string): boolean {
  return /^-(\s|$)/.test(text);
}

/** A map or a list whose lines start at `indent`, and the index of the line after it. */
function block(lines: Line[], start: number, indent: number): [Value, number] {
  if (isItem(lines[start].text)) return list(lines, start, indent);
  // Without a prototype, a `__proto__` key is the map's own, as js-yaml, which Mocha uses, reads it.
  const map = Object.create(null) as Record<string, Value>;
  let index = start;
  while (index < lines.length && lines[index].indent === indent) {
    const line = lines[index];
    const match = /^("[^"]*"|'[^']*'|[^\s:'"][^:]*?)\s*:(?:\s+(.*))?$/.exec(line.text);
    if (!match) throw new YamlError(`"${line.text}" is not a key and its value`, line.number);
    const key = unquote(match[1], line.number);
    if (Object.hasOwn(map, key)) throw new YamlError(`${key} is set twice, which YAML refuses`, line.number);
    // An optional group that matched nothing is undefined, though the type says it is a string.
    const value = match[2] as string | undefined;
    if (value !== undefined) {
      map[key] = scalarOrFlow(value, line.number);
      index += 1;
    } else if (index + 1 < lines.length && lines[index + 1].indent > indent) {
      [map[key], index] = block(lines, index + 1, lines[index + 1].indent);
    } else if (index + 1 < lines.length && lines[index + 1].indent === indent && isItem(lines[index + 1].text)) {
      // A list may sit at the same indent as its key.
      [map[key], index] = list(lines, index + 1, indent);
    } else {
      map[key] = null;
      index += 1;
    }
  }
  return [map, index];
}

function list(lines: Line[], start: number, indent: number): [Value[], number] {
  const items: Value[] = [];
  let index = start;
  while (index < lines.length && lines[index].indent === indent && isItem(lines[index].text)) {
    const line = lines[index];
    const item = line.text.slice(1).trim();
    if (item === '' || /^[^'"[\]]*:(\s|$)/.test(item)) {
      throw new YamlError('a list item that is a map or spans lines is not read', line.number);
    }
    items.push(scalarOrFlow(item, line.number));
    index += 1;
  }
  return [items, index];
}

/** A scalar, or a list written in brackets, as `[ts, js]`. */
function scalarOrFlow(text: string, line: number): Value {
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new YamlError('a list in brackets must end on its line', line);
    const items = flowItems(text.slice(1, -1));
    // A trailing comma ends the list without another item, as in `[ts, js,]`.
    if (items.at(-1) === '') items.pop();
    if (items.includes('')) throw new YamlError('a list in brackets has an empty item', line);
    return items.map((item) => scalar(item, line));
  }
  return scalar(text, line);
}

/** The items of a list in brackets, split at the commas outside quotes. */
function flowItems(inner: string): string[] {
  const items: string[] = [];
  let item = '';
  let quote: string | null = null;
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index];
    if (quote === null && char === ',') {
      items.push(item.trim());
      item = '';
      continue;
    }
    item += char;
    if (quote === null) {
      if ((char === '"' || char === "'") && item.trim() === char) quote = char;
    } else if (quote === '"' && char === '\\') {
      item += inner[++index] ?? '';
    } else if (char === quote) {
      if (quote === "'" && inner[index + 1] === "'") item += inner[++index];
      else quote = null;
    }
  }
  items.push(item.trim());
  return items;
}

function scalar(text: string, line: number): Value {
  if (/^["']/.test(text)) {
    if (text.length < 2 || text.at(-1) !== text[0]) throw new YamlError('a quoted value must end on its line', line);
    return unquote(text, line);
  }
  // `@`, `` ` `` and `%` are reserved, and `- `, `? ` and `: ` start a list, a key or a value, as js-yaml reads them.
  if (/^([&*!|>{[\]@`%]|[-?:](\s|$))/.test(text)) throw new YamlError(`"${text}" uses YAML that is not read`, line);
  if (/:(\s|$)/.test(text)) {
    throw new YamlError(`"${text}" has a colon and a space outside quotes, which YAML refuses`, line);
  }
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^(null|Null|NULL|~)$/.test(text)) return null;
  // Numbers as YAML 1.2 writes them, which js-yaml, Mocha's reader, follows: `1_000` is a string.
  if (/^0o[0-7]+$/.test(text)) return Number.parseInt(text.slice(2), 8);
  if (/^0x[\da-fA-F]+$/.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^[-+]?(\.\d+|\d+(\.\d*)?)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  return text;
}

/** YAML's escapes in double quotes, besides `\\x`, `\\u` and `\\U` with hex digits. */
const ESCAPES: Record<string, string> = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1B',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\x85',
  _: '\xA0',
  L: '\u2028',
  P: '\u2029',
};

const HEX_DIGITS: Record<string, number> = { x: 2, u: 4, U: 8 };

/** A quoted key or value without its quotes: `''` is a quote in single quotes, and double quotes take escapes. */
function unquote(text: string, line: number): string {
  if (!/^["']/.test(text)) return text;
  const inner = text.slice(1, -1);
  if (text.startsWith("'")) {
    if (inner.replaceAll("''", '').includes("'")) throw new YamlError('a quoted value must end on its line', line);
    return inner.replaceAll("''", "'");
  }
  let value = '';
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index];
    if (char === '"') throw new YamlError('a quoted value must end on its line', line);
    if (char !== '\\') {
      value += char;
      continue;
    }
    const escape = inner[++index] ?? '';
    const size = HEX_DIGITS[escape] ?? 0;
    const digits = inner.slice(index + 1, index + 1 + size);
    const code = size > 0 && /^[\da-fA-F]+$/.test(digits) ? Number.parseInt(digits, 16) : Number.NaN;
    if (digits.length === size && code <= 0x10ffff) {
      value += String.fromCodePoint(code);
      index += size;
    } else if (size === 0 && Object.hasOwn(ESCAPES, escape)) {
      value += ESCAPES[escape];
    } else if (escape === '') {
      throw new YamlError('a quoted value must end on its line', line);
    } else {
      throw new YamlError(`${text} has an escape that is not read`, line);
    }
  }
  return value;
}

/**
 * The line without a `#` comment, which starts after a space or at the start, outside quotes. A quote opens only where
 * a value starts: at the start of the line, after a key's `: `, a list's `- `, or a `[` or `,` in brackets, so the
 * apostrophe in `grep: don't` is part of the value. One pass over the line, as a long one must not stall the scan.
 */
function withoutComment(line: string): string {
  let quote: string | null = null;
  let valueStarts = true;
  let started = false;
  let brackets = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote === '"') {
      if (char === '\\') index++;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") index++;
      else if (char === "'") quote = null;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index).trimEnd();
    if (/\s/.test(char)) continue;
    const endsToken = index + 1 === line.length || /\s/.test(line[index + 1]);
    if ((char === '"' || char === "'") && valueStarts) quote = char;
    else if (char === '[' && valueStarts) brackets++;
    else if (char === ',' && brackets > 0) {
      valueStarts = true;
      continue;
    } else if (char === ':' && endsToken) {
      valueStarts = true;
      continue;
    } else if (char === '-' && endsToken && !started) {
      started = true;
      valueStarts = true;
      continue;
    }
    started = true;
    valueStarts = char === '[';
  }
  return line.trimEnd();
}
