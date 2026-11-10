describe('statement downloads', () => {
  it('offers the latest monthly statement', async () => {
    await browser.url('/statements');
    await expect($('[data-test="latest-statement"]')).toBeEnabled();
  });

  it('offers archived statements', async () => {
    if (!process.env.ARCHIVE_ENABLED) pending('Archived statements require archive access');
    await browser.url('/statements/archive');
    await expect($('[data-test="archive-download"]')).toBeEnabled();
  }, 15000);

  xit('exports a tax summary', async () => {
    await browser.url('/statements/tax');
    await expect($('[data-test="tax-summary"]')).toBeEnabled();
  });
});
