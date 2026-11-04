const { netCash, netQuantity } = require('./netting');

describe('netting', () => {
  test.each([
    ['AAPL', 100, 40, 60],
    ['MSFT', 50, 50, 0],
    ['VOD', 0, 25, -25],
  ])('nets %s fills of %i bought and %i sold to %i', (symbol, bought, sold, net) => {
    const fills = [
      { symbol, side: 'buy', quantity: bought, price: 10 },
      { symbol, side: 'sell', quantity: sold, price: 10 },
    ];
    expect(netQuantity(fills)).toBe(net);
  });

  test.each([
    { side: 'buy', quantity: 100, price: 187.5, cash: -18750 },
    { side: 'sell', quantity: 3, price: 0.1, cash: 0.3 },
  ])('moves $cash in cash for a $side of $quantity at $price', ({ side, quantity, price, cash }) => {
    expect(netCash([{ side, quantity, price }])).toBe(cash);
  });

  test.each`
    side      | quantity | expected
    ${'buy'}  | ${10}    | ${10}
    ${'sell'} | ${10}    | ${-10}
  `('signs a $side of $quantity as $expected', ({ side, quantity, expected }) => {
    expect(netQuantity([{ side, quantity }])).toBe(expected);
  });

  test.each([[[]], [[{ side: 'buy', quantity: 0 }]]])('nets %p to zero', (fills) => {
    expect(netQuantity(fills)).toBe(0);
  });

  // SET-112: cash is rounded per fill, the custodian rounds the total
  test.failing('rounds cash on the total, as the custodian does', () => {
    const fills = [1, 2, 3].map(() => ({ side: 'sell', quantity: 1, price: 0.005 }));
    expect(netCash(fills)).toBe(0.02);
  });
});
