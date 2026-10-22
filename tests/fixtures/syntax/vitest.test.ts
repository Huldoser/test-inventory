// @module-tag market-data
// Every Vitest form the scanner reads, written as one strategy-engine suite. Not meant to run.
import { beforeEach, describe, expect, it, test } from 'vitest';
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
  it('caps the size at the cash available', { concurrent: false }, () => {});
});

describe.shuffle('backtests', { tags: ['slow'] }, () => {
  it('replays 2023', { tags: 'nightly' }, () => {});
});

describe('fees', () => {
  test('charges the minimum commission', { retry: 2 }, () => {});
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

const onNode = (major: number) => (Number(process.versions.node.split('.')[0]) < major ? it.skip : it);

describe('quote feed', () => {
  onNode(22)('reads candles as a stream', () => {});

  it('streams quotes over IPv6', async ({ skip }) => {
    try {
      await fetch('http://[::1]:4173/quotes');
    } catch {
      skip('no IPv6 on this machine');
    }
  });
});

describe('broker session', { timeout: 20_000, retry: { count: 3, delay: 500, condition: /ECONNRESET/ } }, () => {
  test('reconnects after a dropped socket', () => {});
  test('matches fills to orders under load', { repeats: 50 }, () => {});
  test('replays missed fills after a reconnect', () => {}, 60_000);
});

describe('order book', () => {
  test('matches a market order against the best ask', async ({ annotate, expect }) => {
    expect.assertions(1);
    await annotate('Book seeded with 3 ask levels', 'data');
    expect(1).toBe(1);
  });
  test('matches orders under load', async ({ bench }) => {
    await bench('match 10,000 orders', () => {}).run();
  });
  test('', () => {});
});
