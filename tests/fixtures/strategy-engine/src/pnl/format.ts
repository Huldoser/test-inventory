const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' });

/** Signed dollar amount, such as "+$1,234.50" or "-$12.00". */
export function formatPnl(amount: number): string {
  return usd.format(amount);
}

export function formatPercent(fraction: number): string {
  return `${fraction > 0 ? '+' : ''}${(fraction * 100).toFixed(2)}%`;
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('formatPnl', () => {
    it('adds a plus sign to gains', () => {
      expect(formatPnl(1234.5)).toBe('+$1,234.50');
    });

    it('keeps the minus sign on losses', () => {
      expect(formatPnl(-12)).toBe('-$12.00');
    });

    it('shows zero without a sign', () => {
      expect(formatPnl(0)).toBe('$0.00');
    });
  });

  it('formats a drawdown as a percentage', () => {
    expect(formatPercent(-0.1834)).toBe('-18.34%');
  });
}
