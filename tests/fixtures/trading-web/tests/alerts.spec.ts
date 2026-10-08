import { test, expect } from '../fixtures/index';
import { isMarketClosed } from '../test-data/market-hours';

test.describe('price alerts', () => {
  test.skip(isMarketClosed(), 'Alerts only trigger while the market is open');

  test.beforeEach(async ({ alertsPage }) => {
    await alertsPage.goTo();
  });

  test('notifies when the price crosses above the alert', async ({ alertsPage }) => {
    await alertsPage.create('AAPL', 'above', 1);
    await expect(alertsPage.notifications).toContainText('AAPL is above $1.00');
  });

  test('does not notify for a price that was never reached', async ({ alertsPage }) => {
    await alertsPage.create('AAPL', 'above', 100_000);
    await expect(alertsPage.notifications).toHaveCount(0);
  });

  test('deletes an alert', async ({ alertsPage }) => {
    await alertsPage.create('MSFT', 'below', 1);
    await alertsPage.alerts.filter({ hasText: 'MSFT' }).getByRole('button', { name: 'Delete' }).click();
    await expect(alertsPage.alerts.filter({ hasText: 'MSFT' })).toHaveCount(0);
  });
});
