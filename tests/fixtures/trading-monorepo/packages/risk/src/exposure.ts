export interface Holding {
  symbol: string;
  sector: string;
  quantity: number;
  price: number;
}

/** Share of the portfolio's gross value held in each sector. */
export function exposure(holdings: Holding[]): Record<string, number> {
  const gross = holdings.reduce((sum, holding) => sum + Math.abs(holding.quantity * holding.price), 0);
  const bySector: Record<string, number> = {};
  for (const holding of holdings) {
    bySector[holding.sector] = (bySector[holding.sector] ?? 0) + Math.abs(holding.quantity * holding.price) / gross;
  }
  return bySector;
}
