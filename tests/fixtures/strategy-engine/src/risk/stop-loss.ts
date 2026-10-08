export type Side = 'long' | 'short';

/** Stop price a fixed percentage away from the entry, on the losing side of the trade. */
export function fixedStop(entry: number, percent: number, side: Side = 'long'): number {
  const distance = (entry * percent) / 100;
  return Math.round((side === 'long' ? entry - distance : entry + distance) * 100) / 100;
}

/** A trailing stop only moves in the trade's favour. */
export function trailStop(currentStop: number, lastPrice: number, percent: number, side: Side = 'long'): number {
  const candidate = fixedStop(lastPrice, percent, side);
  return side === 'long' ? Math.max(currentStop, candidate) : Math.min(currentStop, candidate);
}

export function isStoppedOut(stop: number, lastPrice: number, side: Side = 'long'): boolean {
  return side === 'long' ? lastPrice <= stop : lastPrice >= stop;
}
