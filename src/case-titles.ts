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
