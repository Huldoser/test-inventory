import { expect, test } from 'bun:test';
import { route } from './router.ts';

test('routes to the venue asked for', () => {
  expect(route('ARCX')).toBe('ARCX');
});

test('falls back to the primary venue', { timeout: 2_000 }, () => {
  expect(route('XTKS')).toBe('XNAS');
});

test.serial('keeps the routing table between orders', () => {
  expect(route(undefined)).toBe('XNAS');
});
