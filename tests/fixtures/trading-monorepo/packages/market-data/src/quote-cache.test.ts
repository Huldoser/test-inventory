import { QuoteCache } from './quote-cache.ts';

describe('QuoteCache', () => {
  const cache = new QuoteCache(5_000);

  beforeEach(() => {
    cache.put({ symbol: 'AAPL', bid: 187.48, ask: 187.52, receivedAt: 1_000 });
  });

  it('returns the mid price of a fresh quote', () => {
    expect(cache.mid('AAPL', 2_000)).toBeCloseTo(187.5);
  });

  it('drops a quote older than the maximum age', () => {
    expect(cache.get('AAPL', 6_001)).toBeUndefined();
  });

  it('keeps the newer quote when updates arrive out of order', () => {
    cache.put({ symbol: 'AAPL', bid: 187.6, ask: 187.64, receivedAt: 3_000 });
    cache.put({ symbol: 'AAPL', bid: 187.1, ask: 187.14, receivedAt: 2_000 });
    expect(cache.get('AAPL', 3_500)?.bid).toBe(187.6);
  });
});
