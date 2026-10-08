import { describe, expect, test } from 'vitest';
import { isHalted, nextSession } from '../../src/risk/daily-loss-limit.ts';

describe.concurrent('daily loss limit', () => {
  test('allows trading while the loss is below the limit', () => {
    expect(isHalted({ sessionDate: '2026-03-02', realizedPnl: -1_999 }, 2_000)).toBe(false);
  });

  test('halts trading when the loss reaches the limit', () => {
    expect(isHalted({ sessionDate: '2026-03-02', realizedPnl: -2_000 }, 2_000)).toBe(true);
  });

  test('resets the loss at the start of the next session', ({ skip }) => {
    skip(process.env.TZ !== 'America/New_York', 'session boundaries are checked in New York time');
    const day = { sessionDate: '2026-03-02', realizedPnl: -2_000 };
    expect(nextSession(day, new Date('2026-03-03T09:30:00'))).toEqual({ sessionDate: '2026-03-03', realizedPnl: 0 });
  });
});
