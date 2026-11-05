const { grossExposure, netExposure } = require('../src/exposure');

describe('exposure', () => {
  let positions;

  beforeEach(() => {
    positions = [
      { symbol: 'AAPL', quantity: 100, price: 187.5 },
      { symbol: 'TSLA', quantity: -40, price: 251.25 },
    ];
  });

  it('sums gross exposure', () => {
    expect(grossExposure(positions)).toBeCents(28800);
  });

  it('nets longs against shorts', () => {
    expect(netExposure(positions)).toBeCents(8700);
  });

  it('reads positions from the prime broker', async () => {
    expect(positions.length).toBe(2);
  }, 15_000);

  // RISK-77: options are valued at their premium for now
  it('includes the delta of options');

  xit('converts foreign positions to USD', () => {});

  it('includes futures at their notional', () => {
    pending('RISK-81: futures need the contract multiplier');
  });

  it('includes positions in the overnight session', () => {
    if (!process.env.EXTENDED_HOURS) pending('Only with extended hours');
    expect(positions.length).toBe(2);
  });
});
