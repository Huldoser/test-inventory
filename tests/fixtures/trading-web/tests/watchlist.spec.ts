import { test, expect } from '../fixtures/index';

test.describe('watchlist', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ watchlistPage }) => {
    await watchlistPage.goTo();
  });

  test('adds a symbol @smoke', async ({ watchlistPage }) => {
    await watchlistPage.addSymbol('TSLA');
    await expect(watchlistPage.row('TSLA')).toBeVisible();
  });

  test('removes a symbol', async ({ watchlistPage }) => {
    await watchlistPage.addSymbol('META');
    await watchlistPage.removeSymbol('META');
    await expect(watchlistPage.row('META')).toHaveCount(0);
  });

  test('sorts by daily change', async ({ watchlistPage }) => {
    await watchlistPage.sortByChangeButton.click();
    const changes = await watchlistPage.rows.getByTestId('change-percent').allTextContents();
    const values = changes.map((text) => Number.parseFloat(text));
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  test('keeps the watchlist after a reload', async ({ watchlistPage, page }) => {
    await watchlistPage.addSymbol('NFLX');
    await page.reload();
    await expect(watchlistPage.row('NFLX')).toBeVisible();
  });
});
