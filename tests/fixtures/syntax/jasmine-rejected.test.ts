// Forms for which Jasmine stops before it runs any spec of the risk service, and one it catches. Not meant to run.
describe('exposure limits', () => {
  it('sums gross exposure', () => {});
  it('nets longs against shorts', 15_000);
  it('flags a breach of the desk limit', () => {});
});

it.only('computes historical VaR', () => {});

describe('greeks', async () => {
  it('sums the delta', () => {});
});
