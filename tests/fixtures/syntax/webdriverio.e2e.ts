// Every WebdriverIO form the scanner reads on Mocha, written as one broker portal spec, with WebdriverIO's globals. Not
// meant to run.
describe('client order ticket', function () {
  this.timeout(90_000);
  this.retries(1);

  before(async () => {});
  beforeEach(async () => {});
  afterEach(async () => {});
  after(async () => {});

  it('routes a market order', async () => {});
  it('routes a limit order', async () => {}, 2);
  specify('routes a stop order', async () => {}, 0);
  it('routes an iceberg order', async () => {}).timeout(120_000);
  it.only('amends the quantity', async () => {});
  it.skip('amends the price', async () => {}, 3);
  xit('amends the account', async () => {});
  it('routes an options order');
  it('queues the order for the open', async function () {
    if (!process.env.AFTER_HOURS) this.skip();
  });

  for (const venue of ['XNAS', 'ARCX']) {
    it(`routes to ${venue}`, async () => {});
  }

  context('short sales', () => {
    it('needs a locate', async () => {});
  });
});

describe('account statements', () => {
  it('lists the last twelve months', async () => {});
}).timeout(30_000);

describe.skip('cash transfers', () => {
  it('moves cash between accounts', async () => {});
});

xdescribe('wire transfers', () => {
  it('sends a wire', async () => {});
});
