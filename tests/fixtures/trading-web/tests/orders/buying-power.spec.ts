import { test, expect } from '../../fixtures/index';

test.describe('buying power', { tag: ['@orders', '@risk'] }, () => {
  test('rejects an order above buying power', async ({ orderTicket, portfolioPage }) => {
    await portfolioPage.goTo();
    const cash = Number((await portfolioPage.cashBalance.innerText()).replace(/[$,]/g, ''));
    await orderTicket.open('AMZN');
    await orderTicket.buy({ quantity: Math.ceil(cash / 100) + 1_000 });
    await expect(orderTicket.error).toHaveText('Insufficient buying power');
  });

  test('allows an order that uses all buying power', async ({ orderTicket, portfolioPage }) => {
    await portfolioPage.goTo();
    const cash = Number((await portfolioPage.cashBalance.innerText()).replace(/[$,]/g, ''));
    const limitPrice = 180;
    await orderTicket.open('AMZN');
    await orderTicket.buy({ quantity: Math.floor(cash / limitPrice), limitPrice });
    await expect(orderTicket.error).toBeHidden();
  });
});
