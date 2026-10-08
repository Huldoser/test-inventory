import { describe, expect, test } from 'vitest';
import { commission, secFee, totalFees } from '../../src/pnl/fees.ts';

describe('fees', { tags: ['fees'] }, () => {
  test('charges the minimum commission on a small order', () => {
    expect(commission(10)).toBe(1);
  });

  test('charges per share above the minimum', () => {
    expect(commission(1_000)).toBe(5);
  });

  test('adds the SEC fee only to sales', () => {
    expect(totalFees('buy', 100, 187.5)).toBe(1);
    expect(totalFees('sell', 100, 187.5)).toBe(1.52);
  });

  // TRD-455: half-cent SEC fees round down because of floating point, the broker rounds them up
  test.fails('rounds a half-cent SEC fee up', () => {
    expect(secFee(17_985.61)).toBe(0.51);
  });
});
