// Every Mocha form the scanner reads, written as one order-gateway suite, with Mocha's BDD globals. Not meant to run.
import { describe as group, it as check } from 'mocha';
import { VENUES } from './venues';

describe('order routing', function () {
  this.timeout(10_000);
  this.retries(2);

  before('connects to the venues', function () {});
  after(function () {});
  beforeEach(function () {});
  afterEach(() => {});

  it('routes a market order', () => {});
  specify('routes a limit order', function () {
    this.timeout('30s');
  });
  it('routes an iceberg order', () => {})
    .timeout(500)
    .retries(0);
  it.only('routes a block trade', () => {});

  for (const venue of VENUES) {
    it(`routes to ${venue}`, () => {});
  }

  ['XNAS', 'XLON'].forEach((mic) => {
    it(`quotes on ${mic}`, () => {});
  });

  context('dark pools', function () {
    this.retries(4);
    it('routes a block to a dark pool', () => {});
  }).timeout(60_000);
});

describe('order amendments', () => {
  it('amends the quantity');
  it.skip('amends the price', () => {});
  xit('amends the venue', () => {});
  xspecify('amends the account', () => {});
  it('amends a filled order', function () {
    this.skip();
  });
  it('amends after the close', function () {
    if (new Date().getHours() < 16) this.skip();
  });
});

describe.skip('order cancels', () => {
  it('cancels a working order', () => {});
});

xdescribe('order replaces', () => {
  it('replaces a working order', () => {});
});

xcontext('order expiry', () => {
  it('expires a day order', () => {});
});

describe.only('order fills', () => {
  it('fills a market order', () => {});
});

describe('short sales', () => {
  before(function () {
    if (!process.env.LOCATE_SERVICE) this.skip();
  });
  it('locates the shares first', () => {});
});

group('imported names', () => {
  check('routes through an imported it', () => {});
});
