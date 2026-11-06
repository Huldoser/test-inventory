import { format } from 'node:util';
import type { Value } from './values.ts';

/**
 * The title Vitest gives one case of a `.each` or `.for` table, read from Vitest's `formatTitle` in 3.0, 3.1, 4.1
 * and 5.0: `%#` and `%$` for the case's index, printf placeholders for its items, and `$name` for a key of its object.
 * Vitest 3 formats the whole title and then replaces `$name`, also inside the values it put in; Vitest 4 and 5 format
 * each placeholder on its own and replace `$name` only in the text between them. Vitest 3.0 has no `%$`, and reads
 * `$name` only when the case is an object. Null when the title shows a value the scan doesn't format the way Vitest
 * does, which is any array or object printed as a whole.
 *
 * `version` is Vitest's `[major, minor]`, null for the newest rules. `truncate` is the length Vitest shortens a value to,
 * 40 unless the config sets `chaiConfig.truncateThreshold` (3 and 4) or `taskTitleValueFormatTruncate` (5); 0 keeps
 * values whole.
 */
export function vitestCaseTitle(
  template: string,
  items: readonly Value[],
  index: number,
  version: readonly [number, number] | null,
  truncate = 40,
): string | null {
  const rules = version === null || version[0] >= 5 ? 5 : version[0];
  const isFirst3 = version !== null && version[0] === 3 && version[1] === 0;
  let text = template;
  if (text.includes('%#') || (!isFirst3 && text.includes('%$'))) {
    text = text.replace(/%%/g, ESCAPED).replace(/%#/g, String(index));
    if (!isFirst3) text = text.replace(/%\$/g, String(index + 1));
    text = text.replaceAll(ESCAPED, '%%');
  }
  const count = text.split('%').length - 1;
  if (text.includes('%f')) text = negativeFloats(text, items);
  const isObjectItem = isObject(items[0]);
  const attribute = (key: string): string | null => {
    const isArrayKey = !isFirst3 && /^\d+$/.test(key);
    if (!isObjectItem && !isArrayKey) return `$${key}`;
    const element = isArrayKey ? objectAttr(items, key) : undefined;
    const value = isObjectItem ? objectAttr(items[0], key, element) : element;
    if (value === NOT_PLAIN) return null;
    if (rules === 5) return typeof value === 'string' ? shorten(value, truncate) : prettyFormat(value, truncate);
    return loupe(value, truncate === 0 ? Infinity : truncate);
  };
  if (rules === 3) {
    const formatted = printf(text, items.slice(0, count), rules, truncate);
    return formatted === null ? null : replaceAttributes(formatted, ATTRIBUTE_3, attribute);
  }
  let output = '';
  let used = 0;
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const between = replaceAttributes(
      text.slice(last, match.index),
      rules === 5 ? ATTRIBUTE_5 : ATTRIBUTE_3,
      attribute,
    );
    if (between === null) return null;
    output += between;
    // Each placeholder, `%%` included, takes the next item, also one past the end of the case.
    const placeholder = printf(match[0], [items[used++]], rules, truncate);
    if (placeholder === null) return null;
    output += placeholder;
    last = match.index + match[0].length;
  }
  const rest = replaceAttributes(text.slice(last), rules === 5 ? ATTRIBUTE_5 : ATTRIBUTE_3, attribute);
  return rest === null ? null : output + rest;
}

const ESCAPED = '__vitest_escaped_%__';
const PLACEHOLDER = /%[sdjifoOc%]/g;
const ATTRIBUTE_3 = /\$([$\w.]+)/g;
const ATTRIBUTE_5 = /\$([$\p{ID_Continue}.]+)/gu;
/** A key that leads to something other than a plain value, such as `toString`, which Vitest would show as a function. */
const NOT_PLAIN = Symbol('not plain');

type Primitive = string | number | boolean | null | undefined;

function isPrimitive(value: Value): value is Primitive {
  return typeof value !== 'object' || value === null;
}

function isObject(value: Value | undefined): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Vitest's `objectAttr`: a path such as `order.qty`, `legs[0].side` or `0`, read as `new Object(value)[key]` reads it. */
function objectAttr(
  source: Value | readonly Value[],
  path: string,
  fallback?: Value | typeof NOT_PLAIN,
): Value | typeof NOT_PLAIN {
  let result: unknown = source;
  for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (result === null || result === undefined) return fallback;
    const object = Object(result) as Record<string, unknown>;
    if (Object.hasOwn(object, key)) {
      result = object[key];
    } else if (key in object) {
      return NOT_PLAIN;
    } else {
      return fallback;
    }
    if (result === undefined) return fallback;
  }
  return result as Value;
}

/** `%f` of `-0` shows a minus, which Vitest adds for the item at the same place among the items. */
function negativeFloats(template: string, items: readonly Value[]): string {
  let text = template;
  (template.match(/%f/g) as RegExpMatchArray).forEach((_, index) => {
    if (!Object.is(items[index], -0)) return;
    let occurrence = 0;
    text = text.replace(/%f/g, (match) => (++occurrence === index + 1 ? '-%f' : match));
  });
  return text;
}

function replaceAttributes(text: string, pattern: RegExp, attribute: (key: string) => string | null): string | null {
  let output = '';
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const value = attribute(match[1]);
    if (value === null) return null;
    output += text.slice(last, match.index) + value;
    last = match.index + match[0].length;
  }
  return output + text.slice(last);
}

/** Vitest's `format()` for a template and its arguments, for the values it shows the way the scan does. */
function printf(template: string, args: readonly Value[], rules: number, truncate: number): string | null {
  let used = 0;
  let output = '';
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const placeholder = match[0];
    const formatted =
      placeholder === '%%'
        ? '%'
        : used >= args.length
          ? placeholder
          : formatValue(placeholder, args[used++], rules, truncate);
    if (formatted === null) return null;
    output += template.slice(last, match.index) + formatted;
    last = match.index + placeholder.length;
  }
  output += template.slice(last);
  // Arguments beyond the placeholders are appended, as `console.log` does.
  for (const value of args.slice(used)) {
    if (!isPrimitive(value)) return null;
    output += ` ${String(value)}`;
  }
  return output;
}

function formatValue(placeholder: string, value: Value, rules: number, truncate: number): string | null {
  switch (placeholder) {
    case '%s':
      if (!isPrimitive(value)) return null;
      return Object.is(value, -0) ? '-0' : String(value);
    case '%d':
      return Number(value).toString();
    case '%i':
      return isPrimitive(value) ? Number.parseInt(String(value)).toString() : null;
    case '%f':
      return isPrimitive(value) ? Number.parseFloat(String(value)).toString() : null;
    case '%j':
      // JSON.stringify(undefined) gives undefined, which the title shows as text.
      return value === undefined ? 'undefined' : JSON.stringify(value);
    case '%c':
      return '';
    default:
      // `%o` and `%O` inspect the value: with loupe in Vitest 3 and 4, with pretty-format and the truncate option in 5.
      if (!isPrimitive(value)) return null;
      return rules === 5 ? prettyFormat(value, truncate) : loupe(value, Infinity);
  }
}

/** A string cut to `length` with an ellipsis, without splitting a surrogate pair; 0 keeps it whole. */
function shorten(text: string, length: number): string {
  if (length === 0 || text.length <= length) return text;
  let end = length - 1;
  if (isHighSurrogate(text[end - 1])) end -= 1;
  return `${text.slice(0, end)}…`;
}

function isHighSurrogate(char: string | undefined): boolean {
  return char !== undefined && char >= '\ud800' && char <= '\udbff';
}

/** Vitest 5's `inspect()` of a value, through pretty-format with single quotes. */
function prettyFormat(value: Value, truncate: number): string | null {
  if (!isPrimitive(value)) return null;
  if (typeof value !== 'string') return Object.is(value, -0) ? '-0' : String(value);
  const quoted = `'${value}'`;
  if (truncate === 0 || quoted.length <= truncate) return quoted;
  let end = truncate - 1;
  if (end > 0 && isHighSurrogate(quoted[end - 1])) end -= 1;
  return `'${quoted.slice(1, end)}…'`;
}

const LOUPE_ESCAPED = new RegExp(
  "['\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u0600-\\u0604\\u070f\\u17b4\\u17b5\\u200c-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff\\ufff0-\\uffff]",
  'g',
);

const LOUPE_ESCAPES: Record<string, string> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  "'": "\\'",
};

/** loupe's `inspect()` of a value, as Vitest 3 and 4 show it, cut to `truncate`. */
function loupe(value: Value, truncate: number): string | null {
  if (!isPrimitive(value)) return null;
  if (typeof value === 'string') {
    const escaped = value.replace(
      LOUPE_ESCAPED,
      (char) => LOUPE_ESCAPES[char] ?? `\\u${`0000${char.charCodeAt(0).toString(16)}`.slice(-4)}`,
    );
    return `'${loupeTruncate(escaped, truncate - 2)}'`;
  }
  if (typeof value !== 'number') return String(value);
  if (Number.isNaN(value) || !Number.isFinite(value)) return String(value);
  if (value === 0) return Object.is(value, -0) ? '-0' : '+0';
  return loupeTruncate(String(value), truncate);
}

function loupeTruncate(text: string, length: number): string {
  if (length < 1 && text.length > 1) return '…';
  if (text.length <= length || text.length <= 1) return text;
  let end = length - 1;
  if (end > 0 && isHighSurrogate(text[end - 1])) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** The text Jest puts in place of `%%` and of `%` in string values while it formats a title. */
const JEST_ESCAPE = '@@__JEST_EACH_PLACEHOLDER_ESCAPE__@@';
const JEST_PLACEHOLDER = /%[#Odfijops]/;
/** The placeholders `util.format` takes an argument for. */
const NODE_PLACEHOLDER = /%[sdifjoOc]/;

/**
 * The title Jest gives one row of a `.each` table of arrays, or of single values, read from `jest-each` 29.0, 29.7,
 * 30.0 and 30.5: `%#` and from 30.0 `%$` for the row's index, then one placeholder per item, in order. `%p` shows the
 * item with pretty-format and the others with Node's `util.format`, which Jest calls too. Items left over are dropped.
 * Null when an item is an array or object that `util.format` would show, which differs between Node versions.
 */
export function jestRowTitle(
  template: string,
  row: readonly Value[],
  index: number,
  version: readonly [number, number] | null,
): string | null {
  const isJest30 = version === null || version[0] >= 30;
  const replacesWithFunction = version === null || version[0] > 30 || (version[0] === 30 && version[1] >= 5);
  let text = template.replaceAll('%%', JEST_ESCAPE).replace('%#', String(index));
  if (isJest30) text = text.replace('%$', String(index + 1));
  for (const item of row) {
    const placeholder = JEST_PLACEHOLDER.exec(text);
    if (placeholder === null) continue;
    const value = typeof item === 'string' ? item.replaceAll('%', JEST_ESCAPE) : item;
    if (placeholder[0] === '%p') {
      const pretty = prettyFormatMin(value);
      // Before 30.5, `$&` and the like in the value are read as replacement patterns, as JavaScript's `replace` does.
      text = replacesWithFunction ? text.replace('%p', () => pretty) : text.replace('%p', pretty);
    } else if (placeholder[0] === '%j' && replacesWithFunction) {
      const json = value === undefined ? 'undefined' : JSON.stringify(value);
      text = text.replace('%j', () => json);
    } else if (isPrimitive(value) || (placeholder[0] === '%j' && NODE_PLACEHOLDER.exec(text)?.[0] === '%j')) {
      text = format(text, value);
    } else {
      return null;
    }
  }
  return text.replaceAll(JEST_ESCAPE, '%');
}

/**
 * The title Jest gives one case of a `.each` table of objects, or one row of a tagged-template table: `$name` and
 * `$name.path` for the case's values, and `$#` for its index. `keepsEscapes` is set for a tagged template, where `%%`
 * stays as written. Null when Jest fails the table, as when a path goes through `null` before 30.0.
 */
export function jestKeysTitle(
  template: string,
  item: Record<string, Value>,
  index: number,
  version: readonly [number, number] | null,
  keepsEscapes: boolean,
): string | null {
  let text: string;
  try {
    text = interpolateKeys(template, item, version);
  } catch {
    return null;
  }
  const title = text.replace('$#', String(index));
  return keepsEscapes ? title : title.replaceAll('%%', '%');
}

/** Jest's `interpolateVariables`, which throws where Jest's does. */
function interpolateKeys(
  template: string,
  item: Record<string, Value>,
  version: readonly [number, number] | null,
): string {
  const [major, minor] = version ?? [Infinity, 0];
  const show = (value: unknown) => (isPrimitive(value as Value) ? String(value) : prettyFormatMin(value as Value));
  if (major === 29 && minor < 4) {
    // Each match of each key is replaced in turn, as text, so a value can hold the next key's match.
    const matches = Object.keys(item).flatMap((key) => template.match(new RegExp(`\\$${key}[\\.\\w]*`, 'g')) ?? []);
    return matches.reduce((title, match) => title.replace(match, show(keyPath(item, match, false))), template);
  }
  let keys = Object.keys(item);
  if (major > 30 || (major === 30 && minor >= 5)) {
    keys = keys.filter((key) => key.length > 0).sort((a, b) => b.length - a.length);
    if (keys.length === 0) return template;
    keys = keys.map((key) => key.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&'));
  }
  const pattern = new RegExp(`\\$(${keys.join('|')})[.\\w]*`, 'g');
  return template.replaceAll(pattern, (match) => show(keyPath(item, match, major >= 30)));
}

/** The value a `$name.path` match leads to, as Jest's `getPath` reads it; from 30.0 `null` and `undefined` end it. */
function keyPath(item: Value, match: string, endsAtNull: boolean): unknown {
  let value: unknown = item;
  for (const key of match.slice(1).split('.')) {
    if (endsAtNull && (value === null || value === undefined)) return String(value);
    // Throws on `null` and `undefined` before 30.0, as Jest's does.
    if (!key || !Object.prototype.hasOwnProperty.call(value, key)) return value;
    value = (value as Record<string, unknown>)[key];
  }
  return endsAtNull && (value === null || value === undefined) ? String(value) : value;
}

/** pretty-format with `{ min: true, maxDepth: 1 }`, as Jest shows a value in a title. */
function prettyFormatMin(value: Value, depth = 0): string {
  if (typeof value === 'string') return `"${value.replaceAll(/"|\\/g, '\\$&')}"`;
  if (isPrimitive(value)) return Object.is(value, -0) ? '-0' : String(value);
  if (depth >= 1) return Array.isArray(value) ? '[Array]' : '[Object]';
  if (Array.isArray(value)) return `[${value.map((item) => prettyFormatMin(item, depth + 1)).join(', ')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${prettyFormatMin(key)}: ${prettyFormatMin(value[key], depth + 1)}`).join(', ')}}`;
}

/**
 * The title Bun gives one case of `.each`, read from Bun 1.2.23, 1.3.14 and 1.4.4: for a case whose first value is an
 * object, first `$key` and `$key.path` for its values, then for every case the placeholders, left to right. `%s` takes
 * a string, `%d` and `%f` a number, `%i` an integer, `%j` and `%o` any value as JSON; a value of another type leaves
 * the placeholder as written, but is used up. `%#` is the index, `%%` a `%`, and `%` before any other character is
 * dropped. Once the values are used up, the rest stays as written. Null where Bun pretty-prints: `%p`, and `$key`
 * of an object, `null` or `undefined`.
 */
export function bunCaseTitle(
  template: string,
  args: readonly Value[],
  index: number,
  version: readonly [number, number] | null,
): string | null {
  let text = template;
  const [first] = args;
  if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
    const quotes = version !== null && (version[0] < 1 || (version[0] === 1 && version[1] < 3));
    const shown = { all: true };
    text = text.replace(/\$([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g, (written, path: string) => {
      let value: Value | undefined = first;
      for (const key of path.split('.')) {
        value = value !== null && typeof value === 'object' && !Array.isArray(value) ? value[key] : undefined;
      }
      if (value === undefined && !hasPath(first, path)) return written;
      if (typeof value === 'string') return quotes ? JSON.stringify(value) : value;
      if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
      if (typeof value === 'boolean') return String(value);
      shown.all = false;
      return written;
    });
    if (!shown.all) return null;
  }
  let out = '';
  let used = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char !== '%' || at === text.length - 1) {
      out += char;
      continue;
    }
    if (used >= args.length) return out + text.slice(at);
    const placeholder = text[++at];
    if (placeholder === '#') out += String(index);
    else if (placeholder === '%') out += '%';
    else if (placeholder === 'p') return null;
    else if ('sdfijo'.includes(placeholder)) {
      const formatted = bunValue(placeholder, args[used++]);
      if (formatted === null) return null;
      out += formatted;
    } else out += placeholder;
  }
  return out;
}

/** Whether an object has a value at a dotted path, `undefined` included. */
function hasPath(item: Value, path: string): boolean {
  let value: Value | undefined = item;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !(key in value)) return false;
    value = value[key];
  }
  return true;
}

/** One placeholder of a Bun title, or the placeholder as written for a value of another type; null for a JSON Bun shows otherwise. */
function bunValue(placeholder: string, value: Value): string | null {
  const written = `%${placeholder}`;
  if (placeholder === 's') return typeof value === 'string' ? value : written;
  if (placeholder === 'd' || placeholder === 'f') return typeof value === 'number' ? String(value) : written;
  if (placeholder === 'i') return typeof value === 'number' && Number.isInteger(value) ? String(value) : written;
  return value === undefined ? null : JSON.stringify(value);
}
