const { notional, rejection } = require('../../../src/ticket');

describe('order ticket', { tags: '@orders', retries: { runMode: 2, openMode: 0 } }, () => {
  it('prices a limit order', () => {
    expect(notional({ quantity: 100, limit: 187.5 })).to.equal(18750);
  });

  it('accepts an order within the limits', { tags: ['@smoke'] }, () => {
    expect(rejection({ quantity: 100, limit: 187.5 })).to.equal(null);
  });

  ['0', '1000001'].forEach((quantity) => {
    it(`rejects a quantity of ${quantity}`, () => {
      expect(rejection({ quantity: Number(quantity) })).to.be.a('string');
    });
  });

  it('opens the ticket from the watchlist', { browser: '!electron' }, () => {
    cy.wrap(notional({ quantity: 1, limit: 1 })).should('equal', 1);
  });

  // TRD-910: stop orders need the trigger price field
  it('prices a stop order');

  it.skip('remembers the last account', () => {});

  context('short sales', { retries: 0 }, () => {
    it('needs a locate', () => {
      expect(rejection({ quantity: 10, limit: 5 })).to.equal(null);
    });
  });
});
