// Every node:test form the scanner reads, written as one pricing service test file. Not meant to run.
import assert from 'node:assert/strict';
import test, { after, afterEach, before, beforeEach, describe, it, suite } from 'node:test';

describe('quote book', { concurrency: true }, () => {
  before(() => {});
  beforeEach(() => {});
  afterEach(() => {});
  after(() => {});

  it('keeps the best bid', () => {});
  it('keeps the best ask', { timeout: 2_000, tags: ['quotes'] }, () => {});
  it.skip('streams quotes from the venue', () => {});
  it('streams depth from the venue', { skip: 'needs the venue sandbox' }, () => {});
  it('streams trades', { skip: !process.env.VENUE_URL }, () => {});
  it.todo('drops a stale quote after 500 ms');
  it('expires a quote', { todo: true });
  it.only('quotes the spread', () => {});
  it('quotes without a function');

  for (const tier of ['retail', 'institutional']) {
    it(`widens quotes for the ${tier} tier`, () => {});
  }

  suite.skip('dark pool quotes', () => {
    it('hides the size', () => {});
  });
});

test('reprices a stale basket', { expectFailure: 'stale prices' }, () => {
  assert.fail('stale');
});

test(async function crossesRates() {});

test('reprices a basket', async (t) => {
  await t.test('reprices equities', async (equities) => {
    await equities.test('reprices the open', () => {});
  });
  await t.test('reprices bonds', async (bonds) => {
    if (!process.env.BOND_FEED) bonds.skip('no bond feed');
  });
  t.todo('swaps not priced yet');
});

test('reprices a closed market', { skip: 'market closed' }, async (t) => {
  await t.test('reprices futures', () => {});
});
