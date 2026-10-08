import { describe, expect, it } from 'vitest';
import { maxDrawdown, positionPnl, unrealizedPnl } from '../../src/pnl/pnl.ts';

describe('positionPnl', () => {
  it('averages the cost of two buys', () => {
    const position = positionPnl([
      { side: 'buy', quantity: 10, price: 100 },
      { side: 'buy', quantity: 30, price: 120 },
    ]);
    expect(position).toEqual({ quantity: 40, averageCost: 115, realized: 0 });
  });

  it('realizes P&L on a partial sell at the average cost', () => {
    const position = positionPnl([
      { side: 'buy', quantity: 40, price: 115 },
      { side: 'sell', quantity: 10, price: 130 },
    ]);
    expect(position.realized).toBe(150);
    expect(position.quantity).toBe(30);
  });

  it('shows a loss on a position below its cost', () => {
    expect(unrealizedPnl({ quantity: 30, averageCost: 115, realized: 0 }, 110)).toBe(-150);
  });
});

describe('maxDrawdown', () => {
  it('measures the largest drop from a peak', () => {
    expect(maxDrawdown([100_000, 112_000, 98_000, 104_000, 120_000])).toBeCloseTo(-0.125);
  });

  it('is zero for an equity curve that only rises', () => {
    expect(maxDrawdown([100, 101, 105])).toBe(0);
  });
});
