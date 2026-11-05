const BASE_URL = process.env.TRADING_WEB_URL || 'http://localhost:3000';

describe('watchlist', function () {
  before(function () {
    if (!process.env.MARKET_DATA_URL) this.skip();
  });

  it('streams a quote for a symbol it adds', async function () {
    await this.page.goto(`${BASE_URL}/watchlist`);
    await this.page.type('[name=symbol]', 'MSFT');
    await this.page.keyboard.press('Enter');
    await this.page.waitForSelector('[data-symbol=MSFT] [data-field=last]');
  });
});
