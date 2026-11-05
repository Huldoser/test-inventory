// Every Jasmine form the scanner reads, written as one risk-service suite, with Jasmine's globals. Not meant to run.
import { DESKS } from './desks';

describe('exposure limits', () => {
  beforeAll(() => {});
  beforeEach(() => {}, 5000);
  afterEach(() => {});
  afterAll(() => {});

  it('sums gross exposure', () => {});
  it('nets longs against shorts', async () => {}, 15_000);
  fit('flags a breach of the desk limit', () => {});
  it('includes the delta of options');
  xit('converts foreign positions to USD', () => {});

  it('includes futures at their notional', () => {
    pending('RISK-81: futures need the contract multiplier');
  });

  it('includes positions in the overnight session', () => {
    if (!process.env.EXTENDED_HOURS) pending();
  });

  it('skips cash accounts', () => {
    notApplicable('Cash accounts have no margin');
  });

  for (const desk of DESKS) {
    it(`stays within the ${desk} limit`, () => {});
  }

  ['equities', 'rates'].forEach((assetClass) => {
    it(`reports ${assetClass} exposure`, () => {});
  });

  describe('stressed', () => {
    beforeEach(() => {
      pending('RISK-90: stress scenarios are not loaded');
    });
    it('replays the 2008 shock', () => {});
  });
});

xdescribe('value at risk', () => {
  it('computes historical VaR', () => {});
});

fdescribe('greeks', () => {
  it('sums the delta', () => {});
});
