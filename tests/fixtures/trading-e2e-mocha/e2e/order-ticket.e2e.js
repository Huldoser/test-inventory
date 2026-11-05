const assert = require('node:assert/strict');

const BASE_URL = process.env.TRADING_WEB_URL || 'http://localhost:3000';

describe('order ticket', function () {
  beforeEach(async function () {
    await this.page.goto(`${BASE_URL}/trade/AAPL`);
  });

  it('places a limit order', async function () {
    await this.page.type('[name=quantity]', '100');
    await this.page.type('[name=limit]', '187.50');
    await this.page.click('button[data-side=buy]');
    await this.page.waitForSelector('text/Order accepted');
  });

  for (const [quantity, message] of [
    ['0', 'Quantity must be at least 1'],
    ['1000001', 'Quantity is above the 1,000,000 share limit'],
  ]) {
    it(`rejects a quantity of ${quantity}`, async function () {
      await this.page.type('[name=quantity]', quantity);
      await this.page.click('button[data-side=buy]');
      assert.equal(await this.page.$eval('[role=alert]', (alert) => alert.textContent), message);
    });
  }

  it('shows the order in the blotter', async function () {
    this.timeout(60_000);
    await this.page.click('button[data-side=buy]');
    await this.page.goto(`${BASE_URL}/blotter`);
    await this.page.waitForSelector('text/AAPL');
  });

  // TRD-861: the ticket keeps the last symbol after a reload
  it.skip('clears the ticket after a reload', async function () {
    await this.page.reload();
  });
});
