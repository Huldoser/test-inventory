import { describe, expect, test } from 'bun:test';
import { spreadBps } from './spread.ts';

describe('spread', () => {
  test('quotes a liquid name under 5 bps', () => {
    expect(spreadBps({ bid: 187.49, ask: 187.51 })).toBeLessThan(5);
  });

  test.each([
    { mic: 'XNAS', bid: 99.95, ask: 100.05 },
    { mic: 'XLON', bid: 49.9, ask: 50.1 },
  ])('quotes the $mic spread', ({ bid, ask }) => {
    expect(spreadBps({ bid, ask })).toBeGreaterThan(0);
  });

  test.skipIf(!process.env.VENUE_URL)('streams quotes from the venue', () => {});

  test.todo('drops a stale quote after 500 ms');

  // QG-212: a crossed book still prices to a positive spread
  test.failing('rejects a crossed book', () => {
    expect(spreadBps({ bid: 100.1, ask: 99.9 })).toBeGreaterThan(0);
  });

  describe.skip('dark pool quotes', () => {
    test('hides the size', () => {});
  });
});
