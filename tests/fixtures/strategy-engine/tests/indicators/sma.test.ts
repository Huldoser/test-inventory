import { describe, expect, test } from 'vitest';
import { sma } from '../../src/indicators/sma.ts';

describe('sma', () => {
  test.each([
    { period: 1, closes: [101.2, 102.4, 100.9], expected: [101.2, 102.4, 100.9] },
    { period: 2, closes: [10, 20, 30, 40], expected: [null, 15, 25, 35] },
    { period: 3, closes: [187.5, 188.25, 186.75, 189], expected: [null, null, 187.5, 188] },
    { period: 5, closes: [1, 2, 3], expected: [null, null, null] },
  ])('averages the last $period closes', ({ period, closes, expected }) => {
    expect(sma(closes, period)).toEqual(expected);
  });

  test('rejects a period of zero', () => {
    expect(() => sma([100, 101], 0)).toThrow('period must be a positive integer, got 0');
  });

  test('returns an empty series for no closes', () => {
    expect(sma([], 20)).toEqual([]);
  });
});
