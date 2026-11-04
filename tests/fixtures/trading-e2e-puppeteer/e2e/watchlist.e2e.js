describe('watchlist', () => {
  it('adds a symbol from the search box', async () => {
    await page.goto(`${process.env.TRADING_WEB_URL || 'http://localhost:3000'}/watchlist`);
    await expect(page).toFill('input[type=search]', 'MSFT');
    await page.keyboard.press('Enter');
    await expect(page).toMatchElement('[data-symbol=MSFT]');
  }, 60000);

  it.todo('reorders symbols by dragging');
});
