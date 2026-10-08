/** Relative strength index with Wilder's smoothing, from 0 to 100; null until `period` changes are known. */
export function rsi(closes: readonly number[], period = 14): (number | null)[] {
  const result: (number | null)[] = closes.map(() => null);
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (index <= period) {
      averageGain += gain / period;
      averageLoss += loss / period;
      if (index < period) continue;
    } else {
      averageGain = (averageGain * (period - 1) + gain) / period;
      averageLoss = (averageLoss * (period - 1) + loss) / period;
    }
    result[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
}
