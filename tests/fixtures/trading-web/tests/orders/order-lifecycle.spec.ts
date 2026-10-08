import { test, expect } from '../../fixtures/index';

// One order moves through every status, so each step depends on the one before.
test.describe('order lifecycle', { tag: '@orders' }, () => {
  test.describe.configure({ mode: 'serial' });

  test('places a limit order for 100 NVDA', async ({ orderTicket, blotter }) => {
    await orderTicket.open('NVDA');
    await orderTicket.buy({ quantity: 100, limitPrice: 118 });
    await orderTicket.confirm();
    await expect(blotter.status('NVDA')).toHaveText('Working');
  });

  test('shows a partial fill', async ({ blotter }) => {
    await expect(blotter.status('NVDA')).toHaveText(/Partially filled \(\d+\/100\)/);
  });

  test('cancels the remaining quantity', async ({ blotter }) => {
    await blotter.cancel('NVDA');
    await expect(blotter.status('NVDA')).toHaveText(/Cancelled \(\d+\/100 filled\)/);
  });
});
