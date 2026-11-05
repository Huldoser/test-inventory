import { routingBlock } from '../../../src/orders.js';

describe('client order ticket', function () {
  this.timeout(90_000);

  it('routes an order within the buying power', async () => {
    expect(routingBlock({ quantity: 100, buyingPower: 25_000, price: 187.5 })).toBe(null);
  });

  // Flaky on the shared grid: the quote stream can lag behind the first render.
  it('blocks an order above the buying power', async () => {
    expect(routingBlock({ quantity: 200, buyingPower: 25_000, price: 187.5 })).toBe(
      'The order is above the buying power',
    );
  }, 2);

  for (const quantity of [0, 1.5]) {
    it(`blocks a quantity of ${quantity}`, async () => {
      expect(routingBlock({ quantity, buyingPower: 25_000, price: 1 })).toBe('Quantity must be at least 1');
    });
  }

  // BRK-418: options orders need the contract picker
  it('routes an options order');

  context('after the close', () => {
    it('queues the order for the open', async function () {
      if (!process.env.AFTER_HOURS) this.skip();
      expect(routingBlock({ quantity: 1, buyingPower: 1, price: 1 })).toBe(null);
    });
  });
});
