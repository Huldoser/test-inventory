import { describe, expect, test } from 'vitest';
import type { Order } from '../../src/orders/order.ts';
import { validateOrder, type Account } from '../../src/orders/validate-order.ts';

const account: Account = { buyingPower: 25_000, positions: { AAPL: 40 }, canShortSell: false };

const invalidOrders: [string, Order, string][] = [
  [
    'a fractional quantity',
    { symbol: 'AAPL', side: 'buy', type: 'market', quantity: 1.5 },
    'quantity must be a positive whole number',
  ],
  [
    'a negative limit price',
    { symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 1, limitPrice: -5 },
    'price must be positive',
  ],
  [
    'a buy above buying power',
    { symbol: 'NVDA', side: 'buy', type: 'limit', quantity: 300, limitPrice: 118 },
    'insufficient buying power',
  ],
  [
    'a sell of shares not held',
    { symbol: 'AAPL', side: 'sell', type: 'market', quantity: 41 },
    'insufficient shares to sell',
  ],
];

describe('validateOrder', () => {
  test.each(invalidOrders)('rejects %s', (_, order, error) => {
    expect(validateOrder(order, account, 187.5)).toBe(error);
  });

  test('accepts a limit buy within buying power', () => {
    expect(
      validateOrder({ symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 100, limitPrice: 187.5 }, account, 189),
    ).toBeNull();
  });

  test('prices a market buy at the last trade', () => {
    const order: Order = { symbol: 'MSFT', side: 'buy', type: 'market', quantity: 60 };
    expect(validateOrder(order, account, 420)).toBe('insufficient buying power');
  });

  test.skipIf(process.env.MARKET === 'closed')('accepts a stop order to protect a position', () => {
    expect(
      validateOrder({ symbol: 'AAPL', side: 'sell', type: 'stop', quantity: 40, stopPrice: 180 }, account, 187.5),
    ).toBeNull();
  });
});
