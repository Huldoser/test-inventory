import { test, expect } from '../../fixtures/index';

test.describe('market orders', { tag: ['@orders', '@smoke'] }, () => {
  test.beforeEach(async ({ orderTicket }) => {
    await orderTicket.open('MSFT');
  });

  test('fills a market buy order', async ({ orderTicket, blotter }) => {
    await orderTicket.buy({ quantity: 5 });
    await orderTicket.confirm();
    await expect(blotter.status('MSFT')).toHaveText('Filled');
  });

  test('fills a market sell order', async ({ orderTicket, blotter }) => {
    await orderTicket.sell({ quantity: 2 });
    await orderTicket.confirm();
    await expect(blotter.status('MSFT')).toHaveText('Filled');
  });

  test('shows the estimated cost before placing the order', async ({ orderTicket }) => {
    await orderTicket.buy({ quantity: 10 });
    await expect(orderTicket.estimatedCost).toHaveText(/^\$\d{1,3}(,\d{3})*\.\d{2}$/);
  });
});
