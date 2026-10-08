import { test, expect } from '../../fixtures/index';
import { TAGS } from '../../test-data/tags';

test.describe('orders', { tag: '@orders' }, () => {
  test.describe('limit orders', () => {
    test.beforeEach(async ({ orderTicket }) => {
      await orderTicket.open('AAPL');
    });

    test('places a limit buy order for AAPL @smoke', async ({ orderTicket, blotter }) => {
      await orderTicket.buy({ quantity: 10, limitPrice: 187.5 });
      await orderTicket.confirm();
      await expect(blotter.status('AAPL')).toHaveText('Working');
    });

    test('cancels an open limit order', { tag: TAGS.risk }, async ({ orderTicket, blotter }) => {
      await orderTicket.buy({ quantity: 5, limitPrice: 180 });
      await orderTicket.confirm();
      await blotter.cancel('AAPL');
      await expect(blotter.status('AAPL')).toHaveText('Cancelled');
    });

    // FIXME: TRD-412 the confirm dialog stays open on WebKit
    test(
      'rejects a limit price far from the last trade',
      { annotation: { type: 'issue', description: 'TRD-412' } },
      async ({ browserName, orderTicket }) => {
        test.fixme(browserName === 'webkit', 'confirm dialog stays open on WebKit');
        await orderTicket.buy({ quantity: 1, limitPrice: 1 });
        await expect(orderTicket.error).toHaveText('Limit price is more than 50% away from the last trade.');
      },
    );
  });
});
