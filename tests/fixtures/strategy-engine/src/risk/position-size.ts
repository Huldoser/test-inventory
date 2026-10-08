/**
 * Number of shares to buy so that hitting the stop loses at most `riskPercent` of the account.
 * Rounds down to whole shares and never spends more than the account holds.
 */
export function positionSize(accountValue: number, riskPercent: number, entry: number, stop: number): number {
  if (entry <= 0 || stop <= 0) throw new RangeError('prices must be positive');
  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare === 0) throw new RangeError('the stop must differ from the entry price');
  const byRisk = Math.floor((accountValue * riskPercent) / 100 / riskPerShare);
  const byCash = Math.floor(accountValue / entry);
  return Math.max(0, Math.min(byRisk, byCash));
}
