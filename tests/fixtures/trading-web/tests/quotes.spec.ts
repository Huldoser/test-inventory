import { test, expect } from '../fixtures/index';
import { WATCHED_SYMBOLS } from '../test-data/symbols';

test.describe('quotes', () => {
  for (const symbol of WATCHED_SYMBOLS) {
    test(`shows a live quote for ${symbol}`, async ({ watchlistPage }) => {
      await watchlistPage.goTo();
      await expect(watchlistPage.lastPrice(symbol)).toHaveText(/^\d+\.\d{2}$/);
    });
  }
});
