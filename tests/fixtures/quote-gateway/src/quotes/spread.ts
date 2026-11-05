/** The quoted spread in basis points: the gap between bid and ask over their mid price. */
export function spreadBps({ bid, ask }: { bid: number; ask: number }): number {
  const mid = (bid + ask) / 2;
  return Math.round(((ask - bid) / mid) * 10_000 * 100) / 100;
}
