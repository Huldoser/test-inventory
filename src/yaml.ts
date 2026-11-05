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
 * first are refused with a `YamlError`, as a guess at them could read the wrong test files.
 */
export function readYaml(text: string): Value {
  const lines: Line[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const content = withoutComment(raw);
    if (content.trim() === '' || (index === 0 && content.trim() === '---')) return;
    lines.push({ number: index + 1, indent: content.length - content.trimStart().length, text: content.trim() });
  });
  if (lines.length === 0) return {};
  const [value, next] = block(lines, 0, lines[0].indent);
  if (next < lines.length) throw new YamlError('a line is indented less than the one it continues', lines[next].number);
  return value;
}

/** A map or a list whose lines start at `indent`, and the index of the line after it. */
function block(lines: Line[], start: number, indent: number): [Value, number] {
  if (lines[start].text.startsWith('-')) return list(lines, start, indent);
  const map: Record<string, Value> = {};
  let index = start;
  while (index < lines.length && lines[index].indent === indent) {
    const line = lines[index];
    const match = /^("[^"]*"|'[^']*'|[^\s:'"][^:]*?)\s*:(?:\s+(.*))?$/.exec(line.text);
    if (!match) throw new YamlError(`"${line.text}" is not a key and its value`, line.number);
    const key = unquote(match[1]);
    // An optional group that matched nothing is undefined, though the type says it is a string.
    const value = match[2] as string | undefined;
    if (value !== undefined) {
      map[key] = scalarOrFlow(value, line.number);
      index += 1;
    } else if (index + 1 < lines.length && lines[index + 1].indent > indent) {
      [map[key], index] = block(lines, index + 1, lines[index + 1].indent);
    } else if (
      index + 1 < lines.length &&
      lines[index + 1].indent === indent &&
      lines[index + 1].text.startsWith('-')
    ) {
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
  while (index < lines.length && lines[index].indent === indent && lines[index].text.startsWith('-')) {
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
    // A trailing comma ends the list without another item, as in `[ts, js,]`.
    const items = text
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim());
    if (items.at(-1) === '') items.pop();
    return items.map((item) => scalar(item, line));
  }
  return scalar(text, line);
}

function scalar(text: string, line: number): Value {
  if (/^["']/.test(text)) {
    if (text.length < 2 || text.at(-1) !== text[0]) throw new YamlError('a quoted value must end on its line', line);
    try {
      return unquote(text);
    } catch {
      throw new YamlError(`${text} has an escape that is not read`, line);
    }
  }
  if (/^[&*!|>{]/.test(text)) throw new YamlError(`"${text}" uses YAML that is not read`, line);
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^(null|Null|NULL|~)$/.test(text)) return null;
  // Numbers as YAML 1.2 writes them, which js-yaml, Mocha's reader, follows: `1_000` is a string.
  if (/^0o[0-7]+$/.test(text)) return Number.parseInt(text.slice(2), 8);
  if (/^0x[\da-fA-F]+$/.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^[-+]?(\.\d+|\d+(\.\d*)?)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  return text;
}

function unquote(text: string): string {
  if (text.startsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text.startsWith('"')) return JSON.parse(text) as string;
  return text;
}

/**
 * The line without a `#` comment, which starts after a space or at the start, outside quotes. A quote opens only where
 * a value or key starts, so the apostrophe in `grep: don't` is part of the value.
 */
function withoutComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if ((char === '"' || char === "'") && /(^|[\s:,[-])\s*$/.test(line.slice(0, index))) {
      quote = char;
    } else if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}
