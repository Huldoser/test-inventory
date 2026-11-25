import type { Node } from 'oxc-parser';

export type ArrayReadTime = number | { end: number; step: number } | null;

interface TimedEdit {
  end: number;
  step?: number;
}

// An enclosing assignment follows the helper on its right-hand side even when their source ranges end together.
function stepOf(edit: TimedEdit): number {
  return edit.step ?? Number.MAX_SAFE_INTEGER;
}

export function compareEdits(a: TimedEdit, b: TimedEdit): number {
  return a.end - b.end || stepOf(a) - stepOf(b);
}

export function visibleAt(change: TimedEdit, time: ArrayReadTime): boolean {
  if (time === null) return true;
  if (typeof time === 'number') return change.end <= time;
  return change.end < time.end || (change.end === time.end && stepOf(change) <= time.step);
}

export function upperBound<T>(items: readonly T[], included: (item: T) => boolean): number {
  let lo = 0,
    hi = items.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (included(items[mid])) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface ReadPoint {
  position: number;
  time: ArrayReadTime;
}

/** Match a read inside a helper to the writes already made during the same module-level call. */
export class HelperReadTimes {
  private readonly owners = new Map<Node, Map<number, ReadPoint[] | null>>();

  add(owner: Node, start: number, position: number, time: ArrayReadTime, repeated: boolean): void {
    let calls = this.owners.get(owner);
    if (!calls) {
      calls = new Map<number, ReadPoint[] | null>();
      this.owners.set(owner, calls);
    }
    const prior = calls.get(start);
    if (prior === null) return;
    if (repeated || (prior && position === owner.start)) calls.set(start, null);
    else if (prior) prior.push({ position, time });
    else calls.set(start, [{ position, time }]);
  }

  at(owner: Node, position: number, start: number | null): ArrayReadTime {
    if (start === null) return null;
    const points = this.owners.get(owner)?.get(start);
    if (points === undefined) return start;
    if (points === null) return null;
    return points[Math.max(0, upperBound(points, (point) => point.position <= position) - 1)].time;
  }
}
