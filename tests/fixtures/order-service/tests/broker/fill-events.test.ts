import { describe, expect, test } from 'vitest';
import { filledShares, toOrderStatus } from '../../src/broker/fill-events.ts';

describe('toOrderStatus', () => {
  test.for([
    { event: 'new', status: 'working' },
    { event: 'partial_fill', status: 'partially-filled' },
    { event: 'fill', status: 'filled' },
    { event: 'canceled', status: 'canceled' },
    { event: 'rejected', status: 'rejected' },
  ] as const)('maps a $event event to $status', ({ event, status }) => {
    expect(toOrderStatus({ event, orderId: 'ORD-7731', filledQuantity: 0 })).toBe(status);
  });
});

describe('filledShares', () => {
  test('counts the shares of a full fill', () => {
    expect(filledShares({ event: 'fill', orderId: 'ORD-7731', filledQuantity: 100 })).toBe(100);
  });

  // BUG: TRD-588 fractional partial fills are rounded down to whole shares
  test.fails('keeps the fractional shares of a partial fill', () => {
    expect(filledShares({ event: 'partial_fill', orderId: 'ORD-7732', filledQuantity: 2.5 })).toBe(2.5);
  });
});
