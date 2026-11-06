import assert from 'node:assert/strict';
import test from 'node:test';
import { crossRate } from '../../src/rates.js';

const usdPer = { EUR: 1.08, GBP: 1.27, JPY: 0.0066 };

test('crosses EUR into GBP', () => {
  assert.equal(crossRate(usdPer, 'EUR', 'GBP'), 0.850394);
});

test('refuses a currency without a USD rate', () => {
  assert.throws(() => crossRate(usdPer, 'EUR', 'CHF'), RangeError);
});

test.skip('crosses through a triangulation currency', () => {});
