import { describe, expect, it } from 'vitest';
import { codes, onlyTest, scanWebdriverIO } from './helpers.ts';

describe('WebdriverIO tests', () => {
  it("reads Mocha's calls, with a number after a test's function as its retries", () => {
    const inventory = scanWebdriverIO(`
describe('order ticket', function () {
  this.timeout(30_000);
  it('places a market order', async () => {}, 2);
  it('places a limit order', async () => {});
  it('places a stop order', async function () {
    this.retries(1);
  });
  it.skip('replaces an order', async () => {}, 3);
});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.timeout, test.retries])).toEqual([
      ['places a market order', 'active', 30_000, 2],
      ['places a limit order', 'active', 30_000, null],
      ['places a stop order', 'active', 30_000, 1],
      ['replaces an order', 'skip', 30_000, 3],
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

  it('reports a call that fails the spec file, while the other files run', () => {
    const inventory = scanWebdriverIO("it('routes an order', async () => {});\ndescribe('blotter');");
    expect(inventory.diagnostics.map((item) => item.message)).toEqual([
      'describe() has no function, so WebdriverIO fails the spec file and runs none of its tests.',
    ]);
    expect(onlyTest(inventory).state).toBe('notLoaded');
  });
});
