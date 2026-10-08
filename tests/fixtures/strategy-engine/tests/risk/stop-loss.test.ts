import { describe, expect, it } from 'vitest';
import { fixedStop, isStoppedOut, trailStop } from '../../src/risk/stop-loss.ts';

describe('stop-loss', () => {
  describe('fixedStop', () => {
    it('places a long stop below the entry', () => {
      expect(fixedStop(200, 5)).toBe(190);
    });

    it('places a short stop above the entry', () => {
      expect(fixedStop(200, 5, 'short')).toBe(210);
    });
  });

  describe('trailStop', () => {
    it('raises a long stop when the price rises', () => {
      expect(trailStop(190, 220, 5)).toBe(209);
    });

    it('never lowers a long stop', () => {
      expect(trailStop(190, 195, 5)).toBe(190);
    });
  });

  it.each([
    ['long', 189.99, true],
    ['long', 190.01, false],
    ['short', 210, true],
  ] as const)('a %s position at %d is stopped out: %s', (side, price, expected) => {
    expect(isStoppedOut(side === 'long' ? 190 : 210, price, side)).toBe(expected);
  });
});
