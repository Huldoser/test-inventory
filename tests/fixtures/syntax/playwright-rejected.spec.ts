// Forms for which Playwright refuses to load the whole file, so every test in it is `notLoaded`. Not meant to run.
import { test } from '@playwright/test';

test.describe('order ticket', { tag: '@orders' }, () => {
  test('validates the symbol', { tag: 'validation' }, async () => {});

  test('shows the order preview');

  test.skip('places a stop order', async () => {});
});

test.only.skip('places a bracket order', async () => {});

test('places a market order', async () => {});

test.describe('order ticket', () => {
  test('places a market order', async () => {});
});
