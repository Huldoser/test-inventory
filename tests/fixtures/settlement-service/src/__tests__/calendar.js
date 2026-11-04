const { describe, expect, it } = require('@jest/globals');
const { settlementDate } = require('../calendar');

describe('settlement calendar', () => {
  it('settles a Monday trade on Tuesday at T+1', () => {
    expect(settlementDate('2026-11-02', 1)).toBe('2026-11-03');
  });

  it('skips the weekend', () => {
    expect(settlementDate('2026-11-06', 1)).toBe('2026-11-09');
  });

  it('skips exchange holidays', () => {
    expect(settlementDate('2026-12-24', 1)).toBe('2026-12-28');
  });

  it.todo('skips half days before a holiday');
});
