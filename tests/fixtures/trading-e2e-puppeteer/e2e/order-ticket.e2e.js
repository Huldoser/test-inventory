/**
 * @group e2e/order-ticket
 */
const BASE_URL = process.env.TRADING_WEB_URL || 'http://localhost:3000';

describe('order ticket', () => {
  beforeEach(async () => {
    await page.goto(`${BASE_URL}/trade/AAPL`);
  });

  it('places a limit order', async () => {
    await expect(page).toFill('[name=quantity]', '100');
    await expect(page).toFill('[name=limit]', '187.50');
    await expect(page).toClick('button', { text: 'Buy' });
    await expect(page).toMatchTextContent('Order accepted');
  });

  it.each([
    ['0', 'Quantity must be at least 1'],
    ['-5', 'Quantity must be at least 1'],
    ['1000001', 'Quantity is above the 1,000,000 share limit'],
  ])('rejects a quantity of %s', async (quantity, message) => {
    await expect(page).toFill('[name=quantity]', quantity);
    await expect(page).toClick('button', { text: 'Buy' });
    await expect(page).toMatchTextContent(message);
  });

  // TRD-861: the ticket keeps the last symbol after a reload
  it.skip('clears the ticket after a reload', async () => {
    await jestPuppeteer.resetPage();
  });
});
