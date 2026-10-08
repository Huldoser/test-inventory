import { sma } from '../indicators/sma.ts';
import type { MarketDataClient } from '../market-data/client.ts';

export type Signal = 'buy' | 'sell' | 'hold';

/** Buys when the fast average crosses above the slow one and sells when it crosses below. */
export function crossoverSignals(closes: readonly number[], fast = 20, slow = 50): Signal[] {
  if (fast >= slow) throw new RangeError('the fast period must be shorter than the slow period');
  const fastAverage = sma(closes, fast);
  const slowAverage = sma(closes, slow);
  return closes.map((_, index) => {
    const [fastNow, slowNow] = [fastAverage[index], slowAverage[index]];
    const [fastBefore, slowBefore] = [fastAverage[index - 1], slowAverage[index - 1]];
    if (fastNow === null || slowNow === null || fastBefore == null || slowBefore == null) return 'hold';
    if (fastBefore <= slowBefore && fastNow > slowNow) return 'buy';
    if (fastBefore >= slowBefore && fastNow < slowNow) return 'sell';
    return 'hold';
  });
}

export async function latestSignal(client: MarketDataClient, symbol: string, asOf: string): Promise<Signal> {
  const from = new Date(Date.parse(asOf) - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const candles = await client.dailyCandles(symbol, from, asOf);
  return crossoverSignals(candles.map((candle) => candle.close)).at(-1) ?? 'hold';
}
