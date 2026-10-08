import { test, expect } from '../fixtures/index';

test.describe('backtests', { tag: '@backtest' }, () => {
  test.beforeEach(async ({ backtestPage }) => {
    await backtestPage.goTo();
  });

  test('runs an SMA crossover backtest', async ({ backtestPage }) => {
    test.slow();
    await backtestPage.run('SMA crossover (20/50)', 'AAPL', '2023-01-01', '2024-12-31');
    await expect(backtestPage.totalReturn).toHaveText(/^[+-]\d+\.\d{2}%$/);
    await expect(backtestPage.maxDrawdown).toHaveText(/^-\d+\.\d{2}%$/);
  });

  test('lists every trade the strategy made', async ({ backtestPage }) => {
    await backtestPage.run('SMA crossover (20/50)', 'MSFT', '2024-01-01', '2024-06-30');
    await expect(backtestPage.trades).not.toHaveCount(0);
  });

  test.fail(
    'exports trades to CSV',
    { annotation: { type: 'issue', description: 'TRD-377' } },
    async ({ backtestPage }) => {
      await backtestPage.run('RSI mean reversion', 'NVDA', '2024-01-01', '2024-03-31');
      const download = backtestPage.page.waitForEvent('download');
      await backtestPage.exportButton.click();
      expect((await download).suggestedFilename()).toMatch(/^trades-NVDA-\d{8}\.csv$/);
    },
  );
});
