import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spreadBps, widen } from './spread.js';

test('quotes the spread in basis points', () => {
  assert.equal(spreadBps({ bid: 99.95, ask: 100.05 }), 10);
});

test('widens a quote for the retail tier', () => {
  assert.deepEqual(widen({ bid: 99.95, ask: 100.05 }, 5), { bid: 99.925, ask: 100.075 });
});
