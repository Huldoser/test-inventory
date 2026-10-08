/** Simple moving average of the last `period` values for each position; null until there are enough values. */
export function sma(values: readonly number[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new RangeError(`period must be a positive integer, got ${period}`);
  return values.map((_, index) => {
    if (index < period - 1) return null;
    const window = values.slice(index - period + 1, index + 1);
    return window.reduce((sum, value) => sum + value, 0) / period;
  });
}
