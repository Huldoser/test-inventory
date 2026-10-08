export interface Fill {
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
}

export interface PositionPnl {
  quantity: number;
  averageCost: number;
  realized: number;
}

/** Realized P&L with average-cost accounting, from fills in the order they happened. */
export function positionPnl(fills: readonly Fill[]): PositionPnl {
  let quantity = 0;
  let averageCost = 0;
  let realized = 0;
  for (const fill of fills) {
    if (fill.side === 'buy') {
      averageCost = (averageCost * quantity + fill.price * fill.quantity) / (quantity + fill.quantity);
      quantity += fill.quantity;
    } else {
      realized += (fill.price - averageCost) * fill.quantity;
      quantity -= fill.quantity;
      if (quantity === 0) averageCost = 0;
    }
  }
  return { quantity, averageCost, realized };
}

export function unrealizedPnl(position: PositionPnl, lastPrice: number): number {
  return (lastPrice - position.averageCost) * position.quantity;
}

/** Largest drop from a running peak of the equity curve, as a negative fraction. */
export function maxDrawdown(equity: readonly number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, (value - peak) / peak);
  }
  return worst;
}
