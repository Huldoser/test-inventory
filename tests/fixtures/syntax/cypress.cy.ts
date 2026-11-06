// Every Cypress form the scanner reads, written as one trading web app spec, with Cypress's globals. Not meant to run.
describe('order ticket', { tags: ['@orders', '@smoke'], retries: { runMode: 2, openMode: 0 } }, () => {
  before(() => {});
  beforeEach(() => {});
  afterEach(() => {});
  after(() => {});

  it('places a market order', () => {});
  specify('places a limit order', { retries: 3 }, () => {});
  it('places an iceberg order', { tags: '@algo' }, () => {});
  it('opens the depth chart', { browser: '!firefox' }, () => {});
  it('routes to a dark pool', { env: { VENUE: 'XDARK' } }, () => {});
  it.only('amends the quantity', () => {});
  it.skip('amends the price', () => {});
  xit('amends the account', () => {});
  it('cancels a working order');
  it('fills an order', function () {
    this.skip();
  });

  ['XNAS', 'XLON'].forEach((mic) => {
    it(`routes to ${mic}`, () => {});
  });

  context('short sales', { browser: ['chrome', 'edge'] }, () => {
    it('needs a locate', () => {});
  });
});

describe.skip('watchlist', () => {
  it('adds a symbol', () => {});
});
