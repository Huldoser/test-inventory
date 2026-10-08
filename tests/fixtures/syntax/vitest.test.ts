// @module-tag market-data
// Every Vitest form the scanner reads, written as one strategy-engine suite. Not meant to run.
import { bench, beforeEach, describe, expect, it, test } from 'vitest';
import { HISTORICAL_CLOSES } from './closes';

describe('sma', () => {
  test.each([
    [[1, 2, 3], 2, [null, 1.5, 2.5]],
    [[10, 20], 1, [10, 20]],
  ])('averages %j over %d closes', (closes, period, expected) => {});

  test.for([{ symbol: 'AAPL' }, { symbol: 'MSFT' }])(
    'matches the reference for $symbol',
    ({ symbol }, { expect }) => {},
  );

  test.each`
    closes    | period | expected
    ${[1, 2]} | ${2}   | ${[null, 1.5]}
  `('averages $closes', () => {});

  test.each(HISTORICAL_CLOSES)('matches the reference on %s', () => {});
});

describe.concurrent('position sizing', () => {
  it('risks 1% of the account', () => {});
  it.sequential('caps the size at the cash available', () => {});
});

describe.sequential('stop orders', () => {
  it('triggers below the stop price', () => {});
});

describe.shuffle('backtests', { tags: ['slow'] }, () => {
  it('replays 2023', { tags: 'nightly' }, () => {});
});

describe('fees', () => {
  test('charges the minimum commission', () => {}, { retry: 2 });
  test.fails('rounds a half cent up', () => {});
  test.todo('charges a borrow fee');
  test('charges the exchange fee');
  test.skipIf(process.platform === 'win32')('reads fee tables from disk', () => {});
  test.runIf(process.env.BROKER_API_KEY)('checks fees against the broker', () => {});
  test.only.skip('runs alone', () => {});
});

describe('market data client', () => {
  beforeEach(({ skip }) => {
    skip(!process.env.MARKET_DATA_URL, 'needs a market data URL');
  });

  it('fetches daily candles', ({ skip }) => {
    skip(new Date().getDay() === 0, 'no candles on Sunday');
  });
});

describe(() => {
  it('is never collected', () => {});
});

describe('benchmarks', () => {
  bench('sma over ten years of closes', () => {});
});
