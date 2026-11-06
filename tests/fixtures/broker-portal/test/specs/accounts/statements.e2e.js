import { excessMargin, statementMonths } from '../../../src/statements.js';

describe('account statements', () => {
  it('lists the last twelve months', async () => {
    expect(statementMonths(new Date('2026-11-05'), 12)).toHaveLength(12);
  });

  specify('starts with the month before today', async () => {
    expect(statementMonths(new Date('2026-11-05'), 1)).toEqual(['2026-10']);
  });

  it.skip('downloads a statement as PDF', async () => {});

  describe('margin', () => {
    it('shows the excess margin', async function () {
      this.retries(1);
      expect(excessMargin({ equity: 50_000, requirement: 12_500.25 })).toBe(37_499.75);
    });

    xit('shows a margin call banner', async () => {});
  });
});
