import { describe, expect, it } from 'vitest';
import { codes, onlyTest, scanJest, testNamed, titles } from './helpers.ts';
import type { Inventory } from '../src/index.ts';

function states(inventory: Inventory): [string, string, boolean][] {
  return inventory.tests.map((test) => [test.fullName, test.state, test.isOnly]);
}

describe('Jest globals and imports', () => {
  it('reads the globals, with the f and x aliases as only and skip', () => {
    const inventory = scanJest(`
describe('settlement', () => {
  test('books the cash leg', () => {});
  it('books the securities leg', () => {});
  fit('reconciles with the custodian', () => {});
  xit('resends a lost instruction', () => {});
  xtest('amends an instruction', () => {});
});
fdescribe('buy-ins', () => {
  test('buys in a failed delivery', () => {});
});
xdescribe('fails', () => {
  test('marks a trade failed after T+2', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['settlement > books the cash leg', 'active', false],
      ['settlement > books the securities leg', 'active', false],
      ['settlement > reconciles with the custodian', 'active', true],
      ['settlement > resends a lost instruction', 'skip', false],
      ['settlement > amends an instruction', 'skip', false],
      ['buy-ins > buys in a failed delivery', 'active', true],
      ['fails > marks a trade failed after T+2', 'skip', false],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads names imported from @jest/globals, also renamed, and the f and x aliases imported', () => {
    const inventory = scanJest(`
import { describe as group, test as check, xit as later, fit as focus } from '@jest/globals';
group('netting', () => {
  check('nets two fills', () => {});
  later('nets a cancelled fill', () => {});
  focus('nets across accounts', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['netting > nets two fills', 'active', false],
      ['netting > nets a cancelled fill', 'skip', false],
      ['netting > nets across accounts', 'active', true],
    ]);
  });

  it('reads the module through a namespace import, a default import and require()', () => {
    const inventory = scanJest(`
import * as globals from '@jest/globals';
import jestGlobals from '@jest/globals';
const required = require('@jest/globals');
const { it: settles, xdescribe: parked } = require('@jest/globals');
const [unused] = require('@jest/globals');
const fee = required.xtest;
globals.describe('cash', () => {
  globals.test('books a payment', () => {});
  jestGlobals.it.skip('books a refund', () => {});
  fee('books a fee', () => {});
  settles('books a dividend', () => {});
});
parked('corporate actions', () => {
  settles('books a split', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['cash > books a payment', 'active', false],
      ['cash > books a refund', 'skip', false],
      ['cash > books a fee', 'skip', false],
      ['cash > books a dividend', 'active', false],
      ['corporate actions > books a split', 'skip', false],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reports a file that imports Vitest or Playwright', () => {
    const inventory = scanJest(`
import { test } from 'vitest';
import { expect } from '@playwright/test';
test('books the cash leg', () => {});
`);
    expect(codes(inventory)).toEqual(['framework-mismatch', 'framework-mismatch']);
    expect(inventory.diagnostics[0].message).toBe("The file imports 'vitest', but the scan is for Jest.");
  });

  it('keeps the alias of a variable, and only what both branches of a condition share', () => {
    const inventory = scanJest(`
const parked = xit;
const onCi = process.env.CI ? test.concurrent.skip : test.concurrent;
const later = test.skip;
describe('custodian', () => {
  parked('connects over SFTP', () => {});
  onCi('uploads the instruction file', async () => {});
  later('downloads the statement', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.isParallel])).toEqual([
      ['connects over SFTP', 'skip', false],
      ['uploads the instruction file', 'active', true],
      ['downloads the statement', 'skip', false],
    ]);
  });

  it('leaves a local function named like a global alone', () => {
    const inventory = scanJest(`
function fit(trade) { return trade.size <= 100; }
describe('allocation', () => {
  fit({ size: 10 });
  test('allocates to each account', () => {});
});
`);
    expect(titles(inventory)).toEqual(['allocates to each account']);
  });
});

describe('Jest chains', () => {
  it('reads each modifier on the paths Jest has', () => {
    const inventory = scanJest(`
describe('instructions', () => {
  test.only('sends to the custodian', () => {});
  test.todo('cancels an instruction');
  test.concurrent('confirms each fill', async () => {});
  test.concurrent.only('confirms the first fill', async () => {});
  test.concurrent.skip('waits for the custodian', async () => {});
  test.failing('rejects after the cut-off', () => {});
  test.only.failing('rejects a duplicate', () => {});
  test.skip.failing('rejects a short sale', () => {});
  test.concurrent.failing('rejects in parallel', async () => {});
  test.concurrent.only.failing('rejects one alone', async () => {});
});
describe.only('focused', () => {
  test('runs', () => {});
});
describe.skip('skipped', () => {
  test('waits', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.isOnly, test.isParallel])).toEqual([
      ['sends to the custodian', 'active', true, false],
      ['cancels an instruction', 'todo', false, false],
      ['confirms each fill', 'active', false, true],
      ['confirms the first fill', 'active', true, true],
      ['waits for the custodian', 'skip', false, false],
      ['rejects after the cut-off', 'expectedToFail', false, false],
      ['rejects a duplicate', 'expectedToFail', true, false],
      ['rejects a short sale', 'skip', false, false],
      ['rejects in parallel', 'expectedToFail', false, true],
      ['rejects one alone', 'expectedToFail', true, true],
      ['runs', 'active', true, false],
      ['waits', 'skip', false, false],
    ]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it.each([
    ['test.only.concurrent', "test.only.concurrent('settles', () => {});"],
    ['test.failing.only', "test.failing.only('settles', () => {});"],
    ['test.todo.each', "test.todo.each([[1]])('settles %i');"],
    ['describe.concurrent', "describe.concurrent('settlement', () => {});"],
    ['describe.todo', "describe.todo('settlement');"],
    ['test.skipIf', "test.skipIf(true)('settles', () => {});"],
    ['a called modifier', "test.only()('settles', () => {});"],
  ])('reports %s, which Jest does not have, and fails the file', (_, code) => {
    const inventory = scanJest(code);
    expect(codes(inventory)).toEqual(['invalid-chain']);
    expect(inventory.diagnostics[0].message).toMatch(
      /is not part of Jest's API; the call throws, and Jest fails the file\.$/,
    );
    expect(inventory.tests.every((test) => test.state === 'notLoaded')).toBe(true);
  });

  it('reads nothing from .each that is not called', () => {
    const inventory = scanJest(`
const table = test.each;
test.each;
test.each('settles', () => {});
handlers[kind]('settles', () => {});
`);
    expect(inventory.tests).toEqual([]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads a timeout passed third, and warns when it is not a whole number', () => {
    const inventory = scanJest(`
const SLOW = 30_000;
test('replays a day of fills', () => {}, 10_000);
test.concurrent('replays a week', async () => {}, SLOW);
test('replays a month', () => {}, process.env.TIMEOUT);
describe.each([[1]])('day %i', () => {}, 5_000);
`);
    expect(inventory.tests.map((test) => test.timeout)).toEqual([10_000, 30_000, null]);
    expect(codes(inventory)).toEqual(['unresolved-option']);
  });

  it('hashes a body passed by name', () => {
    const inventory = scanJest(`
function checksFees() { expect(fee(100)).toBe(1); }
test('charges the minimum fee', checksFees);
test('charges the minimum fee again', checksFees);
`);
    const [first, second] = inventory.tests;
    expect(first.bodyHash).toBe(second.bodyHash);
    expect(first.hasEmptyBody).toBe(false);
  });

  it('reads a call with spread arguments as a test with an unknown body', () => {
    const inventory = scanJest(`
const args = ['books the cash leg', () => {}];
test(...args);
test();
`);
    expect(inventory.tests).toHaveLength(1);
    expect(inventory.diagnostics.map((item) => item.code)).toEqual(['dynamic-title']);
  });

  it('counts hooks, imported or global', () => {
    const inventory = scanJest(`
import { beforeEach as setUp } from '@jest/globals';
describe('ledger', () => {
  setUp(() => {});
  afterEach(() => {});
  beforeAll(() => {});
  test('posts an entry', () => {});
});
`);
    const test = onlyTest(inventory);
    expect(test.hooks).toEqual(expect.objectContaining({ beforeEach: 1, afterEach: 1, beforeAll: 1 }));
  });
});

describe('Jest declarations Jest refuses', () => {
  it('reports test.todo() with more than a title', () => {
    const inventory = scanJest("test.todo('cancels an instruction', () => {});");
    expect(inventory.diagnostics.map((item) => [item.code, item.message])).toEqual([
      ['invalid-chain', 'test.todo() takes only a title in Jest; with more, the call throws, and Jest fails the file.'],
    ]);
    expect(onlyTest(inventory).state).toBe('notLoaded');
  });

  it('reports a test or describe without a function, which fails the file', () => {
    const inventory = scanJest(`
test('books the cash leg', () => {});
test('reads the holiday calendar');
describe('cut-off times');
`);
    expect(inventory.diagnostics.map((item) => item.message)).toEqual([
      'test() has no test body, so Jest fails to load the file and runs none of its tests.',
      'describe() has no function, so Jest fails to load the file and runs none of its tests.',
    ]);
    expect(onlyTest(inventory).state).toBe('notLoaded');
  });

  it('reports an async describe callback, which fails the file', () => {
    const inventory = scanJest(`
describe('cut-off times', async () => {
  test('uses the custodian cut-off', () => {});
});
`);
    expect(codes(inventory)).toEqual(['async-describe']);
    expect(onlyTest(inventory).state).toBe('notLoaded');
  });
});

describe('jest.retryTimes', () => {
  it('applies the last call made while the file loads to every test of the file', () => {
    const inventory = scanJest(`
jest.retryTimes(1);
test('books the cash leg', () => {});
describe('custodian', () => {
  jest.retryTimes(3);
  test('connects over SFTP', () => {});
});
`);
    expect(inventory.tests.map((test) => [test.retries, test.retriesSource])).toEqual([
      [3, 'file'],
      [3, 'file'],
    ]);
  });

  it('reads waitBeforeRetry from Jest 30 only', () => {
    const code = "jest.retryTimes(2, { waitBeforeRetry: 500 });\ntest('connects over SFTP', () => {});";
    expect(onlyTest(scanJest(code, { frameworkVersion: '29.7.0' })).retryDelay).toBeNull();
    expect(onlyTest(scanJest(code, { frameworkVersion: '30.0.0' })).retryDelay).toBe(500);
  });

  it('keeps entireDescribe to its describe from Jest 30.5', () => {
    const code = `
describe('custodian', () => {
  jest.retryTimes(3, { entireDescribe: true });
  test('connects over SFTP', () => {});
});
test('books the cash leg', () => {});
`;
    const retries = (version: string) =>
      scanJest(code, { frameworkVersion: version }).tests.map((test) => test.retries);
    expect(retries('30.4.0')).toEqual([3, 3]);
    expect(retries('30.5.0')).toEqual([3, null]);
  });

  it('reads the jest object imported, through the module, but not a local one', () => {
    const imported = scanJest(`
import { jest as runner } from '@jest/globals';
runner.retryTimes(2);
test('books the cash leg', () => {});
`);
    expect(onlyTest(imported).retries).toBe(2);
    const required = scanJest(`
const globals = require('@jest/globals');
globals.jest.retryTimes(4);
test('books the cash leg', () => {});
`);
    expect(onlyTest(required).retries).toBe(4);
    const local = scanJest(`
const jest = { retryTimes() {} };
jest.retryTimes(5);
runnerOf().retryTimes(6);
test('books the cash leg', () => {});
`);
    expect(onlyTest(local).retries).toBeNull();
  });

  it('leaves out calls in test bodies and functions, and those under a condition with a warning', () => {
    const inventory = scanJest(`
function flaky() { jest.retryTimes(9); }
test('books the cash leg', () => {
  jest.retryTimes(7);
});
if (process.env.CI) jest.retryTimes(2);
jest.retryTimes(process.env.RETRIES);
jest.retryTimes();
jest.retryTimes(...counts);
`);
    expect(onlyTest(inventory).retries).toBeNull();
    expect(inventory.diagnostics.map((item) => item.message)).toEqual([
      'Option retry: 2 is set only when process.env.CI; it is not applied.',
      'Option retryTimes: process.env.RETRIES could not be worked out; it is not applied.',
    ]);
  });
});

describe('Jest tables', () => {
  it("counts the cases of arrays and tagged templates, and Jest's one failing test for a bad table", () => {
    const inventory = scanJest(`
test.each([[1, 2], [3, 4]])('nets %i and %i', () => {});
test.each(['AAPL', 'MSFT', 'VOD'])('settles %s', () => {});
test.each([])('settles nothing', () => {});
test.each\`
  currency | days
  \${'USD'} | \${1}
  \${'EUR'} | \${2}
\`('settles $currency', () => {});
test.each\`currency | days \${'USD'} | \${1}\`('settles on one line', () => {});
test.each\`
  currency | days
  \${'USD'}
\`('settles a short row', () => {});
test.each\`
  currency | days
\`('settles no rows', () => {});
test.each(CURRENCIES)('settles %s from elsewhere', () => {});
test.each(...tables)('settles %s from a spread', () => {});
test.each()('settles without a table', () => {});
test.each\`\\xZZ\`('settles an escape', () => {});
`);
    expect(inventory.tests.map((test) => test.caseCount)).toEqual([2, 3, 1, 2, 1, 1, 1, null, null, 1, 1]);
    expect(inventory.diagnostics.map((item) => [item.code, item.source])).toEqual([
      ['unresolved-cases', 'CURRENCIES'],
      ['unresolved-cases', '...tables'],
    ]);
  });

  it('lists each case with the title Jest gives it under --expand-cases', () => {
    const inventory = scanJest(
      `
describe.each([['equities'], ['options']])('%s settlement', () => {
  test.each\`
    currency | days
    \${'USD'} | \${1}
  \`('settles $currency in $days days', () => {});
  it.each([{ symbol: 'AAPL' }])('settles $symbol (case $#)', () => {});
  test.each([[0], [-1]])('rejects %p, case %$', () => {});
});
`,
      { expandCases: true },
    );
    expect(inventory.tests.map((test) => test.fullName)).toEqual([
      'equities settlement > settles USD in 1 days',
      'equities settlement > settles AAPL (case 0)',
      'equities settlement > rejects 0, case 1',
      'equities settlement > rejects -1, case 2',
      'options settlement > settles USD in 1 days',
      'options settlement > settles AAPL (case 0)',
      'options settlement > rejects 0, case 1',
      'options settlement > rejects -1, case 2',
    ]);
  });

  it('keeps a table as one record when a case or its title is not known', () => {
    const inventory = scanJest(
      `
test.each([{ symbol: 'AAPL' }])('settles %s', () => {});
test.each([[price()]])('settles at %d', () => {});
test.each\`
  symbol
  \${symbolOf()}
\`('settles $symbol', () => {});
test.each([['AAPL']])(titleOf(), () => {});
test.each\`
  symbol
  \${'AAPL'}
\`(titleOf(), () => {});
test.each([])('settles nothing', () => {});
`,
      { expandCases: true },
    );
    expect(inventory.tests.map((test) => [test.title, test.caseCount])).toEqual([
      ['settles %s', 1],
      ['settles at %d', 1],
      ['settles $symbol', 1],
      ['titleOf()', 1],
      ['titleOf()', 1],
      ['settles nothing', 1],
    ]);
    expect(codes(inventory)).toEqual([
      'cases-not-expanded',
      'cases-not-expanded',
      'cases-not-expanded',
      'cases-not-expanded',
      'dynamic-title',
      'cases-not-expanded',
      'dynamic-title',
      'cases-not-expanded',
    ]);
  });
});

describe('Jest @group pragmas', () => {
  it('gives every test the groups of the file, as jest-runner-groups reads them', () => {
    const inventory = scanJest(`/**
 * Settlement of equity trades.
 *
 * @group settlement/unit
 * @group nightly // run with the nightly job
 * @groups not-a-group
 * @group
 */
test('books the cash leg', () => {});
/**
 * @group late/pragma
 */
`);
    expect(onlyTest(inventory).tags).toEqual(['settlement/unit', 'nightly', 'late/pragma']);
  });

  it('joins a value that goes on over the next line, as jest-docblock does', () => {
    const inventory = scanJest(`/**
 * @group settlement
 * unit
 */
test('books the cash leg', () => {});
`);
    expect(testNamed(inventory, 'books the cash leg').tags).toEqual(['settlement unit']);
  });

  it('keeps the rest of the line after a pragma, as jest-docblock reads the whole file', () => {
    const inventory = scanJest("/** @group settlement */\ntest('books the cash leg', () => {});");
    expect(onlyTest(inventory).tags).toEqual(['settlement */']);
    const oneLine = scanJest("/** @group settlement */ test('books the cash leg', () => {});");
    expect(onlyTest(oneLine).tags).toEqual(["settlement */ test('books the cash leg', () => {});"]);
  });

  it('reads files with Windows line endings', () => {
    const inventory = scanJest("/**\r\n * @group settlement\r\n */\r\ntest('books the cash leg', () => {});\r\n");
    expect(onlyTest(inventory).tags).toEqual(['settlement']);
  });
});
