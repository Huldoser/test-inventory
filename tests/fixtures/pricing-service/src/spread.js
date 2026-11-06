/** The quoted spread in basis points: the gap between bid and ask over their mid price. */
export function spreadBps({ bid, ask }) {
  const mid = (bid + ask) / 2;
  return Math.round(((ask - bid) / mid) * 10_000 * 100) / 100;
}

/** A quote widened by `bps` on each side, for a client tier that pays a markup. */
export function widen({ bid, ask }, bps) {
  const mid = (bid + ask) / 2;
  const half = (mid * bps) / 10_000;
  return { bid: Math.round((bid - half) * 1e4) / 1e4, ask: Math.round((ask + half) * 1e4) / 1e4 };
}
