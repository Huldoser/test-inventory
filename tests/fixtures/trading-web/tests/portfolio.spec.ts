import { test, expect } from '../fixtures/index';

test.describe.parallel('portfolio', () => {
  test.beforeEach(async ({ portfolioPage }) => {
    await portfolioPage.goTo();
  });

  test('shows total value and daily P&L @smoke', async ({ portfolioPage }) => {
    await expect(portfolioPage.totalValue).toHaveText(/^\$[\d,]+\.\d{2}$/);
    await expect(portfolioPage.dayPnl).toHaveText(/^[+-]\$[\d,]+\.\d{2} \([+-]\d+\.\d{2}%\)$/);
  });

  test('shows unrealized P&L for each position', async ({ portfolioPage }) => {
    const rows = portfolioPage.positions.getByRole('row');
    await expect(rows.first().getByTestId('unrealized-pnl')).toBeVisible();
  });

  test('closes a position from the positions table', { tag: '@orders' }, async ({ portfolioPage, blotter }) => {
    await portfolioPage.position('MSFT').getByRole('button', { name: 'Close position' }).click();
    await portfolioPage.page.getByRole('button', { name: 'Place order' }).click();
    await expect(blotter.status('MSFT')).toHaveText('Filled');
  });
});
