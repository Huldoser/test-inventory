import { test, expect } from '../fixtures/index';

test.describe('live price stream', () => {
  test.fixme(({ browserName }) => browserName === 'webkit', 'The WebSocket reconnects in a loop on WebKit (TRD-390)');

  test('updates prices without a reload', async ({ watchlistPage }) => {
    await watchlistPage.goTo();
    const first = await watchlistPage.lastPrice('AAPL').innerText();
    await expect(watchlistPage.lastPrice('AAPL')).not.toHaveText(first, { timeout: 15_000 });
  });

  test('shows a stale badge when the stream disconnects', async ({ watchlistPage, context }) => {
    await watchlistPage.goTo();
    await context.setOffline(true);
    await expect(watchlistPage.page.getByText('Prices delayed')).toBeVisible();
  });
});
