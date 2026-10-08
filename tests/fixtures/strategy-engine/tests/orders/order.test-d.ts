import { describe, expectTypeOf, test } from 'vitest';
import { priceOf, type LimitOrder, type Order, type OrderStatus } from '../../src/orders/order.ts';

describe('Order', () => {
  test('narrows to a limit order by its type', () => {
    const order = { symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 10, limitPrice: 187.5 } as Order;
    if (order.type === 'limit') expectTypeOf(order).toEqualTypeOf<LimitOrder>();
  });

  test('has no price on a market order', () => {
    expectTypeOf(priceOf).returns.toEqualTypeOf<number | null>();
  });

  test('lists every order status', () => {
    expectTypeOf<OrderStatus>().toEqualTypeOf<'working' | 'partially-filled' | 'filled' | 'cancelled' | 'rejected'>();
  });
});
