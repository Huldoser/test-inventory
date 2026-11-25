import type { ArrayExpression, CallExpression, Expression, Node } from 'oxc-parser';
import { unwrapChain } from './ast.ts';
import type { MethodWrite } from './mutation-calls.ts';
import { literalArguments, property, type Reference } from './mutation-references.ts';

export interface PropertySource {
  ref: Reference | null;
  scopes: readonly Node[];
}

export type ArrayChange =
  | MethodWrite
  | (Omit<MethodWrite, 'object' | 'assigned' | 'name' | 'expression'> & {
      name: string;
      call: CallExpression;
    });

function slot(value: Expression | null, scopes: readonly Node[]): PropertySource {
  return { ref: value && { value, path: [] }, scopes };
}

function indexOf(key: string): number | null {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key ? index : null;
}

/** Only literal offsets can determine which existing slots an edit moves. */
function numberAt(expr: Expression | null | undefined, fallback: number): number | null {
  if (!expr) return fallback;
  const value = unwrapChain(expr);
  if (value.type === 'Literal' && typeof value.value === 'number') return Math.trunc(value.value);
  if (
    value.type === 'UnaryExpression' &&
    value.operator === '-' &&
    value.argument.type === 'Literal' &&
    typeof value.argument.value === 'number'
  )
    return Math.trunc(-value.argument.value);
  return null;
}

function relative(n: number, length: number): number {
  return n < 0 ? Math.max(0, length + n) : Math.min(n, length);
}

interface Layout {
  length: number;
  at?: (index: number) => number | PropertySource;
}

/** Translate a slot in the edited array back to its source without allocating holes. */
function splice(length: number, start: number, count: number, inserted: PropertySource[]): Layout {
  const removed = Math.min(count, length - start);
  return {
    length: length - removed + inserted.length,
    at(index) {
      if (index < start) return index;
      const offset = index - start;
      return offset < inserted.length ? inserted[offset] : index - inserted.length + removed;
    },
  };
}

function applyMethod(length: number, event: Extract<ArrayChange, { call: CallExpression }>): Layout | null {
  const { name, scopes } = event;
  const args = [...literalArguments(event.call.arguments)];
  if (!args.every((arg) => arg?.type !== 'SpreadElement')) return null;
  const inserted = (start: number) => args.slice(start).map((arg) => slot(arg, scopes));
  switch (name) {
    case 'push':
      return splice(length, length, 0, inserted(0));
    case 'unshift':
      return splice(length, 0, 0, inserted(0));
    case 'shift':
      return splice(length, 0, 1, []);
    case 'pop':
      return { length: Math.max(0, length - 1) };
    case 'reverse':
      return { length, at: (index) => length - 1 - index };
    case 'splice': {
      const begin = numberAt(args[0], 0);
      const count = numberAt(args[1], args.length === 1 ? length : 0);
      return begin === null || count === null
        ? null
        : splice(length, relative(begin, length), Math.max(count, 0), inserted(2));
    }
    case 'fill': {
      const begin = numberAt(args[1], 0),
        end = numberAt(args[2], length);
      if (begin === null || end === null) return null;
      const start = relative(begin, length),
        stop = relative(end, length),
        element = slot(args[0] ?? null, scopes);
      return { length, at: (index) => (index >= start && index < stop ? element : index) };
    }
    case 'copyWithin': {
      const dest = numberAt(args[0], 0),
        begin = numberAt(args[1], 0),
        end = numberAt(args[2], length);
      if (dest === null || begin === null || end === null) return null;
      const target = relative(dest, length),
        start = relative(begin, length),
        count = relative(end, length) - start;
      return { length, at: (index) => (index >= target && index < target + count ? start + index - target : index) };
    }
    default:
      return null;
  }
}

function applyWrite(length: number, write: MethodWrite, own: Set<string>): Layout | null {
  if (write.name === null) return null;
  if (write.name === 'length') {
    const value = write.assigned && unwrapChain(write.assigned);
    const next = value?.type === 'Literal' ? value.value : null;
    return typeof next === 'number' && Number.isInteger(next) && next >= 0 && next <= 0xffffffff
      ? { length: next }
      : null;
  }
  const key = indexOf(write.name);
  if (key === null) {
    if (write.assigned) own.add(write.name);
    else own.delete(write.name);
    return { length };
  }
  const assigned = slot(write.assigned, write.scopes);
  return {
    length: write.assigned ? Math.max(length, key + 1) : length,
    at: (index) => (index === key ? assigned : index),
  };
}

/** A conditional edit or an unknown layout can select an original slot or one of the inserted values. */
function possibleSlots(
  array: ArrayExpression,
  scopes: readonly Node[],
  changes: readonly ArrayChange[],
): PropertySource[] {
  const candidates = Array.from(property({ value: array, path: [] }, null), (ref) => ({ ref, scopes }));
  for (const change of changes) {
    if (!('call' in change)) {
      if (change.assigned && (change.name === null || indexOf(change.name) !== null))
        candidates.push(slot(change.assigned, change.scopes));
      continue;
    }
    let args = [...literalArguments(change.call.arguments)];
    if (change.name === 'splice') {
      if (!args.slice(0, 2).some((arg) => arg?.type === 'SpreadElement')) args = args.slice(2);
    } else if (change.name === 'fill') args = args.slice(0, 1);
    else if (change.name !== 'push' && change.name !== 'unshift') continue;
    for (const arg of args) {
      if (arg?.type === 'SpreadElement')
        candidates.push({ ref: { value: arg.argument, path: [null] }, scopes: change.scopes });
      else candidates.push(slot(arg, change.scopes));
    }
  }
  return candidates;
}

function upperBound<T>(items: readonly T[], value: number, offset: (item: T) => number): number {
  let lo = 0,
    hi = items.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (offset(items[mid]) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index the edits once. Read a slot at the requested point in module evaluation. */
export function arrayPropertyReader(
  array: ArrayExpression,
  scopes: readonly Node[],
  program: Node,
  history: readonly ArrayChange[],
  spreadLength: (source: Expression, scopes: readonly Node[]) => number | null,
) {
  const elements = [...literalArguments(array.elements)];
  let initialLength = 0;
  let known = true;
  const origins: { start: number; element: ArrayExpression['elements'][number] }[] = [];
  for (const element of elements) {
    const width = element?.type === 'SpreadElement' ? spreadLength(element.argument, scopes) : 1;
    if (width === null) {
      known = false;
      break;
    }
    if (width) origins.push({ start: initialLength, element });
    initialLength += width;
  }
  const missing = slot(null, scopes);
  const layouts: Layout[] = [];
  const own = new Set<string>();
  const ordered = history.every((change) => change.owner === program);
  if (known && ordered) {
    let length = initialLength;
    for (const change of history) {
      if (!change.unconditional) break;
      const next =
        'call' in change
          ? own.has(change.name)
            ? { length }
            : applyMethod(length, change)
          : applyWrite(length, change, own);
      if (!next) break;
      layouts.push(next);
      length = next.length;
    }
  }
  const firstMethod = history.findIndex((change) => 'call' in change);
  // Collection can ask about an earlier copy after looking up a later invocation.
  let cachedCount = -1;
  const cache = new Map<number, PropertySource[]>();
  return (key: string | null, time: number | null): PropertySource[] | null => {
    const index = key === null ? null : indexOf(key);
    if (key !== null && index === null) return null;
    const count = time !== null && ordered ? upperBound(history, time, (change) => change.end) : history.length;
    if (count <= firstMethod) return null;
    if (index === null || time === null || count > layouts.length) {
      const changes = ordered
        ? history.slice(0, count)
        : history.filter((change) => change.owner !== program || time === null || change.end <= time);
      return possibleSlots(array, scopes, changes);
    }
    if (count !== cachedCount) {
      cache.clear();
      cachedCount = count;
    }
    const cached = cache.get(index);
    if (cached) return cached;
    let position: number | PropertySource = index;
    for (let i = count - 1; i >= 0 && typeof position === 'number'; i--) {
      const layout = layouts[i];
      if (position >= layout.length) position = missing;
      else if (layout.at) position = layout.at(position);
    }
    let result: PropertySource = missing;
    if (typeof position !== 'number') result = position;
    else if (position < initialLength) {
      const origin = origins[upperBound(origins, position, (entry) => entry.start) - 1];
      result =
        origin.element?.type === 'SpreadElement'
          ? { scopes, ref: { value: origin.element.argument, path: [String(position - origin.start)] } }
          : slot(origin.element, scopes);
    }
    const found = [result];
    cache.set(index, found);
    return found;
  };
}
