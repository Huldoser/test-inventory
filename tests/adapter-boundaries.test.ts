import { describe, expect, it } from 'vitest';
import { scan } from '../src/index.ts';
import { codes, scanBun, scanCypress, scanMocha, scanNode } from './helpers.ts';
import { project } from './project.ts';

describe('Bun adapter boundaries', () => {
  it('recognizes disabled test and suite aliases', () => {
    const inventory = scanBun(`
import { test, xtest, xdescribe } from 'bun:test';
xtest('prices disabled orders', () => {});
xdescribe('closed order book', () => { test('rejects new orders', () => {}); });
`);
    expect(inventory.tests.map((test) => [test.fullName, test.state, test.stateSource])).toEqual([
      ['prices disabled orders', 'skip', 'test'],
      ['closed order book > rejects new orders', 'skip', 'suite'],
    ]);
    expect(codes(inventory)).toEqual([]);
  });

  it('reads named and inline callbacks before or after their options', () => {
    const inventory = scanBun(`
import { test } from 'bun:test';
function verifyOrder() { return 1; }
test('prices a limit order', verifyOrder, { timeout: 150 });
test('prices a market order', { timeout: 250 }, verifyOrder);
test('prices a stop order', () => { return 1; }, { timeout: 350 });
test('prices a stop limit order', { timeout: 450 }, () => { return 1; });
`);
    expect(inventory.tests.map((test) => test.timeout)).toEqual([150, 250, 350, 450]);
    expect(inventory.tests.every((test) => test.bodyHash !== null)).toBe(true);
    expect(inventory.tests[0].bodyHash).toBe(inventory.tests[1].bodyHash);
    expect(inventory.tests[2].bodyHash).toBe(inventory.tests[3].bodyHash);
    expect(codes(inventory)).toEqual([]);
  });

  it('overrides inherited concurrency only when serialIf applies', () => {
    const inventory = scanBun(`
import { describe, test } from 'bun:test';
describe.concurrent('order book', () => {
  test.serial('serial quotes', () => {});
  test.serialIf(true)('serial fills', () => {});
  test.serialIf(false)('concurrent fills', () => {});
  test.serialIf(process.env.SERIAL)('conditional fills', () => {});
  test('concurrent quotes', () => {});
  test.skip('suspended orders', () => {});
});
`);
    expect(inventory.tests.map((test) => test.isParallel)).toEqual([false, false, true, true, true, true]);
    expect(codes(inventory)).toEqual([]);
  });

  it('finds callbacks after options whose values cannot be worked out', () => {
    const inventory = scanBun(`
import { test } from 'bun:test';
const settings = readOrderSettings();
function verifyOrder() { return 1; }
test('prices configured orders', settings, verifyOrder);
test('prices dynamic orders', settings, () => { return 1; });
`);
    expect(inventory.tests.map((test) => [test.state, test.timeout, test.bodyHash !== null])).toEqual([
      ['active', null, true],
      ['active', null, true],
    ]);
    expect(inventory.diagnostics.map((item) => item.message)).toEqual([
      'Options object settings could not be worked out; its timeout, retry and repeats are missing.',
      'Options object settings could not be worked out; its timeout, retry and repeats are missing.',
    ]);
  });

  it('negates if conditions and prioritizes conditional skip over todo and failing', () => {
    const inventory = scanBun(`
import { test } from 'bun:test';
test.if(true)('prices open orders', () => {});
test.if(false)('prices closed orders', () => {});
test.if(process.env.VENUE)('prices conditional orders', () => {});
test.todoIf(process.env.TODO).skipIf(process.env.SKIP)('prices pending orders', () => {});
test.failingIf(process.env.FAIL).todoIf(process.env.TODO)('prices failing orders', () => {});
`);
    expect(inventory.tests.map((test) => [test.state, test.condition])).toEqual([
      ['active', null],
      ['skip', null],
      ['skip', '!(process.env.VENUE)'],
      ['skip', 'process.env.SKIP'],
      ['todo', 'process.env.TODO'],
    ]);
    expect(codes(inventory)).toEqual([]);
  });
});

describe('adapter option boundaries', () => {
  it.each([1, 2, 8, 4294967295])('sets Node suite concurrency from %s', (concurrency) => {
    const inventory = scanNode(`
import { describe, test } from 'node:test';
describe('routes an order basket', { concurrency: ${concurrency} }, () => {
  test('routes an equity order', () => {});
});
`);
    expect(inventory.tests.map((test) => test.isParallel)).toEqual([concurrency > 1]);
    expect(codes(inventory)).toEqual([]);
  });

  it('keeps a null Cypress retry count unset and identifies invalid retry options', () => {
    const inventory = scanCypress(`
it('routes orders without retries', { retries: null }, () => {});
it('routes orders without a run count', { retries: { openMode: 3 } }, () => {});
it('routes orders with invalid retries', { retries: 'many' }, () => {});
it('routes orders with invalid run retries', { retries: { runMode: 'many' } }, () => {});
`);
    expect(inventory.tests.map((test) => test.retries)).toEqual([null, null, null, null]);
    expect(inventory.diagnostics.map((item) => item.message)).toEqual([
      expect.stringContaining('retries'),
      expect.stringContaining('retries.runMode'),
    ]);
  });

  it('keeps diagnostic reasons when WebdriverIO rejects a Jasmine spec', async () => {
    const root = project({
      'wdio.conf.js': "exports.config = { specs: ['./test/*.js'], framework: 'jasmine' };",
      'test/orders.js': "describe('order book'); it('routes an order', () => {});",
    });
    const inventory = await scan({ root, framework: 'webdriverio', frameworkVersion: '10.1.0' });
    expect(inventory.tests[0].state).toBe('notLoaded');
    expect(inventory.diagnostics[0].message).toContain('WebdriverIO fails the worker');
  });

  it('reads exact Mocha timeout boundaries without treating a number as a unit suffix', () => {
    const inventory = scanMocha(`
it('routes immediate orders', function () { this.timeout('1ms'); });
it('routes queued orders', function () { this.timeout('1.25s'); });
it('routes stale orders', function () { this.timeout('invalid1s'); });
`);
    expect(inventory.tests.map((test) => test.timeout)).toEqual([1, 1250, null]);
  });
});
