import { describe, expect, it } from 'vitest';
import { codes, onlyTest, scanWebdriverIO } from './helpers.ts';

describe('WebdriverIO tests', () => {
  it("reads Mocha's calls, with a number after a plain it()'s function as its retries", () => {
    const inventory = scanWebdriverIO(`
describe('order ticket', function () {
  this.timeout(30_000);
  it('places a market order', async () => {}, 2);
  it('places a limit order', async () => {});
  it('places a stop order', async function () {
    this.retries(1);
  });
  it.skip('replaces an order', async () => {}, 3);
  it.only('amends an order', async () => {}, 3);
});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.timeout, test.retries])).toEqual([
      ['places a market order', 'active', 30_000, 2],
      ['places a limit order', 'active', 30_000, null],
      ['places a stop order', 'active', 30_000, 1],
      ['replaces an order', 'skip', 30_000, null],
      ['amends an order', 'active', 30_000, null],
    ]);
  });

  it.each([
    ['9.33.1', null],
    ['10.1.0', 5000],
  ])(
    "reads a describe's chained timeout as the Mocha WebdriverIO %s runs on does, which reaches its tests from Mocha 12",
    (version, timeout) => {
      const inventory = scanWebdriverIO(
        "describe('blotter', () => {\n  it('lists fills', async () => {});\n}).timeout(5000);",
        {
          frameworkVersion: version,
        },
      );
      expect(onlyTest(inventory).timeout).toBe(timeout);
    },
  );

  it('warns about retries it cannot work out', () => {
    const inventory = scanWebdriverIO("it('places a market order', async () => {}, Number(process.env.RETRIES));");
    expect(onlyTest(inventory).retries).toBeNull();
    expect(codes(inventory)).toEqual(['unresolved-option']);
  });

  it('reports a refused call, which stops the file loading there: the tests declared above it still run', () => {
    const inventory = scanWebdriverIO(
      "it('routes an order', async () => {});\ndescribe('blotter');\nit('cancels an order', async () => {});",
    );
    expect(inventory.diagnostics.map((item) => item.message)).toEqual([
      'describe() has no function, so WebdriverIO runs only the tests declared above it in the file, and none of the spec files after it in its worker.',
    ]);
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([
      ['routes an order', 'active'],
      ['cancels an order', 'notLoaded'],
    ]);
  });
});
