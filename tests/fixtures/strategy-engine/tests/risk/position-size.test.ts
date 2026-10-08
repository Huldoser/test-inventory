import { describe, expect, test } from 'vitest';
import { positionSize } from '../../src/risk/position-size.ts';

describe.concurrent('positionSize', () => {
  test('risks 1% of a $50,000 account on a $2 stop', () => {
    expect(positionSize(50_000, 1, 187.5, 185.5)).toBe(250);
  });

  test('caps the size at what the account can pay for', () => {
    expect(positionSize(10_000, 5, 400, 399.5)).toBe(25);
  });

  test('rounds down to whole shares', () => {
    expect(positionSize(25_000, 0.5, 33.33, 32)).toBe(93);
  });

  test('works for a short trade with the stop above the entry', () => {
    expect(positionSize(50_000, 1, 120, 125)).toBe(100);
  });

  test('rejects a stop equal to the entry', () => {
    expect(() => positionSize(50_000, 1, 100, 100)).toThrow('the stop must differ from the entry price');
  });
});
