import { describe, expect, it } from 'vitest';
import type { Inventory } from '../src/index.ts';
import { codes, onlyTest, scanCypress, testNamed } from './helpers.ts';

function settings(inventory: Inventory): [string, string, string | null, number | null, string[]][] {
  return inventory.tests.map((test) => [test.fullName, test.state, test.condition, test.retries, test.tags]);
}

describe('Cypress tests', () => {
  it("reads Mocha's BDD calls with Cypress's test config: retries, browser and @cypress/grep tags", () => {
    const inventory = scanCypress(`
describe('order ticket', { tags: '@smoke', retries: { runMode: 2, openMode: 0 } }, () => {
  beforeEach(() => {});
  it('places a market order', () => {});
  it('places a limit order', { retries: 3, tags: ['@orders', '@fast'] }, () => {});
  it('places a stop order', { browser: '!firefox' }, () => {});
  it('cancels an order', { tags: '@orders' });
  it.skip('replaces an order', () => {});
  context('blotter', { browser: ['chrome', 'edge'] }, () => {
    specify('lists fills', () => {});
  });
});
`);
    expect(settings(inventory)).toEqual([
      ['order ticket > places a market order', 'active', null, 2, ['@smoke']],
      ['order ticket > places a limit order', 'active', null, 3, ['@smoke', '@orders', '@fast']],
      ['order ticket > places a stop order', 'skip', "browser: '!firefox'", 2, ['@smoke']],
      ['order ticket > cancels an order', 'skip', null, 2, ['@smoke', '@orders']],
      ['order ticket > replaces an order', 'skip', null, 2, ['@smoke']],
      ['order ticket > blotter > lists fills', 'skip', "browser: ['chrome', 'edge']", 2, ['@smoke']],
    ]);
    expect(testNamed(inventory, 'places a stop order').isConditional).toBe(true);
    expect(onlyTest(scanCypress("it('opens the blotter', () => {});")).retries).toBeNull();
  });

  it("reads no Mocha timeout or retries from this, which Cypress doesn't take, and warns about what it can't read", () => {
    const inventory = scanCypress(`
describe('watchlist', function () {
  this.timeout(10_000);
  it('adds a symbol', function () {
    this.retries(4);
  });
  it('removes a symbol', () => {}).timeout(500);
  it('streams a quote', { retries: Number(process.env.RETRIES) }, () => {});
  it('sorts by change', { retries: { openMode: 1 } }, () => {});
  it('pins a symbol', SETTINGS, () => {});
});
`);
    expect(inventory.tests.map((test) => [test.title, test.timeout, test.retries])).toEqual([
      ['adds a symbol', null, null],
      ['removes a symbol', null, null],
      ['streams a quote', null, null],
      ['sorts by change', null, null],
      ['pins a symbol', null, null],
    ]);
    expect(codes(inventory)).toEqual(['unresolved-option', 'unresolved-option']);
  });

  it.each([
    ['15.9.0', []],
    ['16.2.1', ['removed-api']],
  ])("reports env in a test's config from Cypress 16, which refuses it: %s", (version, found) => {
    const inventory = scanCypress("it('fills an order', { env: { DESK: 'equities' } }, () => {});", {
      frameworkVersion: version,
    });
    expect(codes(inventory)).toEqual(found);
  });

  it('reports a chain that is not part of the API, which fails the spec', () => {
    const inventory = scanCypress("it('routes an order', () => {});\nit.concurrent('routes a block', () => {});");
    expect(inventory.diagnostics.map((item) => item.message)).toEqual([
      "it.concurrent is not part of Cypress's API; the call throws, and Cypress fails the spec and runs none of its tests.",
    ]);
    expect(testNamed(inventory, 'routes an order').state).toBe('notLoaded');
  });
});
