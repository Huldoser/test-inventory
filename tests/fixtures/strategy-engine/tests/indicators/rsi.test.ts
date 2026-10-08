import { describe, expect, it } from 'vitest';
import { rsi } from '../../src/indicators/rsi.ts';

const rising = Array.from({ length: 20 }, (_, day) => 100 + day);
const falling = Array.from({ length: 20 }, (_, day) => 200 - day * 2);

describe('rsi', () => {
  it('is null until the period has passed', () => {
    expect(rsi(rising, 14).slice(0, 14)).toEqual(Array.from({ length: 14 }, () => null));
  });

  it('is 100 when prices only rise', () => {
    expect(rsi(rising, 14).at(-1)).toBe(100);
  });

  it('is 0 when prices only fall', () => {
    expect(rsi(falling, 14).at(-1)).toBe(0);
  });

  it.for([
    [70, 'overbought'],
    [30, 'oversold'],
  ] as const)('stays between 0 and 100 around the %s %s line', ([level], { expect }) => {
    const zigzag = Array.from({ length: 40 }, (_, day) => 100 + (day % 2 === 0 ? level / 10 : -level / 10));
    for (const value of rsi(zigzag).filter((item) => item !== null)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
