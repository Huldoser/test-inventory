import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarketDataClient, type Candle } from '../../src/market-data/client.ts';
import { crossoverSignals, latestSignal } from '../../src/strategies/crossover.ts';

vi.mock('../../src/market-data/client.ts', () => ({
  createMarketDataClient: vi.fn(() => ({ dailyCandles: vi.fn() })),
}));

function candles(closes: number[]): Candle[] {
  return closes.map((close, day) => ({
    time: `2024-03-${String(day + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000_000,
  }));
}

describe('crossoverSignals', () => {
  it('buys when the fast average crosses above the slow average', () => {
    const closes = [10, 10, 10, 9, 8, 12, 15];
    expect(crossoverSignals(closes, 2, 4)).toEqual(['hold', 'hold', 'hold', 'hold', 'hold', 'buy', 'hold']);
  });

  it('sells when the fast average crosses below the slow average', () => {
    const closes = [10, 10, 10, 11, 12, 8, 5];
    expect(crossoverSignals(closes, 2, 4)).toEqual(['hold', 'hold', 'hold', 'hold', 'hold', 'sell', 'hold']);
  });

  it('holds before the slow average has enough data', () => {
    expect(crossoverSignals([1, 2, 3], 2, 50)).toEqual(['hold', 'hold', 'hold']);
  });

  it('refuses a fast period that is not shorter than the slow one', () => {
    expect(() => crossoverSignals([1, 2, 3], 50, 20)).toThrow(RangeError);
  });
});

describe('latestSignal', () => {
  const client = createMarketDataClient('https://marketdata.example.com', 'test-key');

  beforeEach(() => {
    vi.mocked(client.dailyCandles).mockReset();
  });

  it('asks for 120 days of daily candles before the given date', async () => {
    vi.mocked(client.dailyCandles).mockResolvedValue(candles([100]));
    await latestSignal(client, 'AAPL', '2024-06-28');
    expect(client.dailyCandles).toHaveBeenCalledWith('AAPL', '2024-02-29', '2024-06-28');
  });

  it('returns the signal for the last candle', async () => {
    const closes = [...Array.from({ length: 50 }, () => 100), ...Array.from({ length: 5 }, (_, day) => 120 + day)];
    vi.mocked(client.dailyCandles).mockResolvedValue(candles(closes));
    expect(await latestSignal(client, 'MSFT', '2024-06-28')).toBe('hold');
  });

  it('holds when there is no data at all', async () => {
    vi.mocked(client.dailyCandles).mockResolvedValue([]);
    expect(await latestSignal(client, 'NVDA', '2024-06-28')).toBe('hold');
  });
});
