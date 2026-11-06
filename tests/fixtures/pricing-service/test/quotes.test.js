import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import { spreadBps, widen } from '../src/spread.js';

describe('quote book', () => {
  it('keeps the spread of a liquid name under 5 bps', () => {
    assert.ok(spreadBps({ bid: 187.49, ask: 187.51 }) < 5);
  });

  it('streams quotes from the venue', { skip: 'needs the venue sandbox' }, () => {});

  it.todo('drops a stale quote after 500 ms');

  describe('tiers', { concurrency: true }, () => {
    for (const [tier, bps] of [
      ['retail', 5],
      ['institutional', 1],
    ]) {
      it(`widens quotes for the ${tier} tier`, () => {
        const wide = widen({ bid: 100, ask: 100 }, bps);
        assert.ok(wide.ask > wide.bid);
      });
    }
  });

  describe.skip('dark pool quotes', () => {
    it('hides the size', () => {});
  });
});

test('reprices a basket', { timeout: 2_000 }, async (t) => {
  await t.test('reprices equities', () => {
    assert.equal(spreadBps({ bid: 50, ask: 50 }), 0);
  });
  await t.test('reprices bonds', async (bonds) => {
    if (!process.env.BOND_FEED) bonds.skip('no bond feed');
  });
});
