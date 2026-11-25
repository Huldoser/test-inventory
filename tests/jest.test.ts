import { describe, expect, it } from 'vitest';
import { headingsMatch } from '../src/frameworks/jest.ts';
import { parseFile } from '../src/parse.ts';
import { Values } from '../src/values.ts';
import { codes, onlyTest, scanJest, testNamed, titles } from './helpers.ts';
import { project } from './project.ts';
import { scan, type Inventory } from '../src/index.ts';

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
const parked = later;
group('netting', () => {
  check('nets two fills', () => {});
  later('nets a cancelled fill', () => {});
  focus('nets across accounts', () => {});
  parked('nets a busted trade', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['netting > nets two fills', 'active', false],
      ['netting > nets a cancelled fill', 'skip', false],
      ['netting > nets across accounts', 'active', true],
      ['netting > nets a busted trade', 'skip', false],
    ]);
  });

  it('reads the module through a namespace import, a default import and require()', () => {
    const inventory = scanJest(`
import * as globals from '@jest/globals';
import jestGlobals from '@jest/globals';
const required = require('@jest/globals');
const { it: settles, xdescribe: parked } = require('@jest/globals');
const [unused] = require('@jest/globals');
const either = process.env.CI ? required.it : required.test;
const fee = required.xtest;
globals.describe('cash', () => {
  globals.test('books a payment', () => {});
  jestGlobals.it.skip('books a refund', () => {});
  fee('books a fee', () => {});
  settles('books a dividend', () => {});
  either('books an interest payment', () => {});
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
      ['cash > books an interest payment', 'active', false],
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

  it.each([
    ['test.failing', "test.failing('rejects after the cut-off', () => {});"],
    [
      'test.concurrent.only.failing.each',
      "test.concurrent.only.failing.each([['AAPL']])('rejects %s', async () => {});",
    ],
  ])('reports %s before Jest 28, whose circus added failing, and fails the file', (_, code) => {
    const before = scanJest(code, { frameworkVersion: '27.5.1' });
    expect(codes(before)).toEqual(['invalid-chain']);
    expect(before.diagnostics[0].message).toMatch(
      / needs Jest 28 or newer; the call throws, and Jest fails the file\.$/,
    );
    expect(before.tests.every((test) => test.state === 'notLoaded')).toBe(true);
    const after = scanJest(code, { frameworkVersion: '28.0.3' });
    expect(after.diagnostics).toEqual([]);
    expect(after.tests.map((test) => test.state)).toEqual(['expectedToFail']);
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
`);
    expect(inventory.tests).toHaveLength(1);
    expect(inventory.diagnostics.map((item) => item.code)).toEqual(['dynamic-title']);
  });

  it('fails the file for an empty declaration and registers undefined titles for test tables', () => {
    for (const [declaration, code] of [
      ['test()', 'test-without-body'],
      ['test.todo()', 'invalid-chain'],
      ['describe()', 'test-without-body'],
      ['describe.each([1, 2])()', 'test-without-body'],
    ]) {
      const result = scanJest(`test('opens the book', () => {});\n${declaration};`);
      expect(testNamed(result, 'opens the book').state).toBe('notLoaded');
      expect(codes(result)).toContain(code);
    }
    for (const [api, count] of [
      ['test', 1],
      ['test.concurrent', 2],
      ['test.failing', 2],
    ] as const) {
      const result = scanJest(`${api}.each([1, 2])();`, { frameworkVersion: '30.5.2', expandCases: true });
      expect(result.tests.map((t) => t.title)).toEqual(Array.from({ length: count }, () => 'undefined'));
    }
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

  it('reports a refused declaration inside a test body as nested, not as failing the file (TI-78)', () => {
    const inventory = scanJest(`
test('rejects an instruction without a body', () => {
  expect(() => it('books the cash leg')).toThrow();
  expect(() => it('books the securities leg', 'cash')).toThrow();
  expect(() => it.todo('books the fee', () => {})).toThrow();
});
`);
    expect(inventory.diagnostics.map((item) => [item.code, item.level])).toEqual([
      ['nested-test', 'warning'],
      ['nested-test', 'warning'],
      ['nested-test', 'warning'],
    ]);
    expect(onlyTest(inventory).state).toBe('active');
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
  it('keeps Jest table tests registered when their callback is a non-callable value', () => {
    const result = scanJest(
      `
const sides = ['bid','ask'];
const missing = null;
test.each(sides)('prices %s', missing, 510);
test.each(sides)('routes %s', 42, 610);
test.concurrent.each(sides)('submits %s', undefined, 710);
test.failing.each(sides)('rejects %s');
test('closes the book',()=>{});
`,
      { frameworkVersion: '29.7.0', expandCases: true },
    );
    expect(result.tests.map((t) => [t.title, t.state, t.timeout])).toEqual([
      ['prices %s', 'active', null],
      ['routes bid', 'active', 610],
      ['routes ask', 'active', 610],
      ['submits bid', 'active', 710],
      ['submits ask', 'active', 710],
      ['rejects bid', 'expectedToFail', null],
      ['rejects ask', 'expectedToFail', null],
      ['closes the book', 'active', null],
    ]);
    expect(result.diagnostics.filter((d) => d.code === 'test-without-body').every((d) => d.level === 'warning')).toBe(
      true,
    );
  });

  it.each([
    ['27.5.1', 2],
    ['28.1.3', 1],
    ['30.5.2', 1],
  ] as const)('counts missing callbacks on skipped tables in Jest %s', (version, skippedCount) => {
    const inventory = scanJest(
      `
test.skip.each([1,2])('checks %i lots');
test.concurrent.skip.each([1,2])('holds %i lots');
test.concurrent.only.each([1,2])('clears %i lots');
`,
      { frameworkVersion: version },
    );
    expect(inventory.tests.map((t) => [t.title, t.caseCount])).toEqual([
      ['checks %i lots', skippedCount],
      ['holds %i lots', skippedCount],
      ['clears %i lots', 2],
    ]);
  });

  it('rejects a Jest suite table whose named callback resolves to undefined', () => {
    const inventory = scanJest(
      `
const setupDesk = undefined;
test('opens the market',()=>{});
describe.each(['bid','ask'])('routes %s', setupDesk);
test('closes the market',()=>{});
`,
      { frameworkVersion: '30.5.2' },
    );
    expect(inventory.tests.map((t) => t.state)).toEqual(['notLoaded', 'notLoaded']);
    expect(codes(inventory)).toContain('test-without-body');
  });

  it('drops the supplied callback and timeout when Jest rejects the table before registering tests', () => {
    const code = `
function post() { expect(2).toBe(2); }
test.each([])('posts a cash leg', post, 700);
test.concurrent.each({desk:'paper'})('routes an order', () => { expect(9).toBe(9); }, 800);
test.skip.each\`
  desk | currency
  \${'paper'}
\`('quotes $desk', post, 900);
test('opens the book', () => {});
`;
    for (const expandCases of [false, true]) {
      const inventory = scanJest(code, { frameworkVersion: '29.7.0', expandCases });
      expect(
        inventory.tests.slice(0, 3).map((t) => [t.title, t.caseCount, t.expectCount, t.bodyHash, t.timeout]),
      ).toEqual([
        ['posts a cash leg', 1, 0, null, null],
        ['routes an order', 1, 0, null, null],
        ['quotes $desk', 1, 0, null, null],
      ]);
      expect(testNamed(inventory, 'opens the book').state).toBe('active');
    }
  });

  it('reports the rejected table before checking a missing callback', () => {
    const inventory = scanJest("test.each([])('posts a cash leg', undefined, 700);", { expandCases: true });
    expect(onlyTest(inventory)).toMatchObject({ caseCount: 1, timeout: null, bodyHash: null, state: 'active' });
    expect(codes(inventory)).toEqual(['cases-not-expanded']);
    expect(inventory.diagnostics[0].message).toContain('Jest rejects the table');
  });

  it('counts the fallback test when Jest cannot interpolate a row and keeps its unused body out of the inventory', () => {
    const code = `
const desks = [{desk:{name:'paper'}},{desk:null},{desk:{name:'live'}}];
function settle() { expect('filled').toBe('filled'); }
test.each(desks)('settles at $desk.name', settle, 500);
test('closes the book', () => {});
`;
    for (const expandCases of [false, true]) {
      const result = scanJest(code, { expandCases, frameworkVersion: '29.7.0' });
      expect(result.tests).toHaveLength(2);
      expect(result.tests[0]).toMatchObject({
        title: 'settles at $desk.name',
        state: 'active',
        isParameterized: true,
        caseCount: 1,
        caseIndex: null,
        expectCount: 0,
        timeout: null,
        bodyHash: null,
      });
      expect(result.tests[1].state).toBe('active');
    }
    expect(scanJest(code, { expandCases: true, frameworkVersion: '30.5.2' }).tests.map((t) => t.title)).toEqual([
      'settles at paper',
      'settles at null',
      'settles at live',
      'closes the book',
    ]);
  });

  it('marks the file as not loaded when Jest cannot interpolate a tagged describe row', () => {
    const code = `
test('opens the book', () => {});
describe.skip.each\`
  desk | venue
  \${{name:'paper'}} | \${'simulated'}
  \${undefined} | \${'live'}
\`('routes to $desk.name', () => { test('settles the order', () => {}); });
test('closes the book', () => {});
`;
    for (const expandCases of [false, true]) {
      const result = scanJest(code, { expandCases, frameworkVersion: '29.7.0' });
      expect(result.tests.map((t) => [t.title, t.state])).toEqual([
        ['opens the book', 'notLoaded'],
        ['settles the order', 'notLoaded'],
        ['closes the book', 'notLoaded'],
      ]);
      expect(codes(result)).toContain('describe-throws');
    }
    expect(
      scanJest(code, { expandCases: true, frameworkVersion: '30.5.2' }).tests.map((t) => [t.fullName, t.state]),
    ).toEqual([
      ['opens the book', 'active'],
      ['routes to paper > settles the order', 'skip'],
      ['routes to undefined > settles the order', 'skip'],
      ['closes the book', 'active'],
    ]);
  });

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

describe('headingsMatch', () => {
  /**
   * jest-each's heading pattern, `^\n\s*[^\s]+\s*(\|\s*[^\s]+\s*)*\n`, written out as the backtracking a regular
   * expression engine does, in its order: the longest word first, its spaces given back one by one, then shorter words;
   * after a heading, another one after a `|` before the line break. It takes exponential time, so only short texts.
   */
  function jestHeadings(text: string): string | null {
    if (!text.startsWith('\n')) return null;
    const isSpace = (index: number) => index < text.length && /\s/.test(text[index]);
    const rest = (at: number): number | null =>
      (text[at] === '|' ? heading(at + 1) : null) ?? (text[at] === '\n' ? at + 1 : null);
    const heading = (at: number): number | null => {
      let start = at;
      while (isSpace(start)) start++;
      let end = start;
      while (end < text.length && !isSpace(end)) end++;
      for (let word = end; word > start; word--) {
        let spaces = word;
        if (word === end) while (isSpace(spaces)) spaces++;
        for (let after = spaces; after >= word; after--) {
          const found = rest(after);
          if (found !== null) return found;
        }
      }
      return null;
    };
    const found = heading(1);
    return found === null ? null : text.slice(0, found);
  }

  it('matches what jest-each matches, for every first line of up to 9 characters of names, |, spaces and line breaks', () => {
    const differences: string[] = [];
    const visit = (text: string) => {
      if (headingsMatch(text) !== jestHeadings(text)) differences.push(JSON.stringify(text));
      if (text.length < 10) for (const char of ['a', '|', ' ', '\n']) visit(text + char);
    };
    visit('\n');
    expect(differences).toEqual([]);
    expect(headingsMatch('symbol | side\n')).toBeNull();
    // Results of jest-each's own pattern, run once on these lines.
    expect(['\na| |\n', '\na |b\n', '\na b\n', '\n||\n'].map(headingsMatch)).toEqual([
      '\na| |\n',
      '\na |b\n',
      null,
      '\n||\n',
    ]);
  });

  it('reads a long line of headings that never matches in one pass', () => {
    expect(headingsMatch(`\n${'a|'.repeat(5000)}a x`)).toBeNull();
  });
});

describe('Jest behaviour checked against Jest 29.7 and 30.5', () => {
  it('runs a describe.only inside a skipped describe, as its own mode wins over the one around it', () => {
    const inventory = scanJest(`
describe.skip('closed venues', () => {
  describe.only('reopened', () => {
    test('settles a trade', () => {});
  });
  test('marks the book', () => {});
});
xdescribe('halted', () => {
  fdescribe('resumed', () => {
    test('nets a fill', () => {});
  });
});
`);
    expect(states(inventory)).toEqual([
      ['closed venues > reopened > settles a trade', 'active', true],
      ['closed venues > marks the book', 'skip', false],
      ['halted > resumed > nets a fill', 'active', true],
    ]);
  });

  it('skips a todo or a .only inside a skipped describe, and the .only focuses nothing', () => {
    const inventory = scanJest(`
describe.skip('closed venues', () => {
  test.todo('nets open positions');
  test.only('books a fill', () => {});
});
test('marks the book', () => {});
`);
    expect(states(inventory)).toEqual([
      ['closed venues > nets open positions', 'skip', false],
      ['closed venues > books a fill', 'skip', false],
      ['marks the book', 'active', false],
    ]);
    expect(inventory.summary.onlyCount).toBe(0);
    expect(codes(inventory)).toEqual(['only-in-skipped-describe']);
  });

  it('leaves the other tests of a describe.only out of focus when one of them uses .only', () => {
    const inventory = scanJest(`
describe.only('netting', () => {
  test.only('nets two fills', () => {});
  test('nets a cancelled fill', () => {});
  test.failing('nets across accounts', () => {});
});
describe.only('fees', () => {
  test('charges the minimum', () => {});
});
`);
    expect(states(inventory)).toEqual([
      ['netting > nets two fills', 'active', true],
      ['netting > nets a cancelled fill', 'active', false],
      ['netting > nets across accounts', 'expectedToFail', false],
      ['fees > charges the minimum', 'active', true],
    ]);
  });

  it('reports a describe callback that returns a value or a promise, which fails the file', () => {
    const inventory = scanJest(`
describe('quotes', () => SYMBOLS.map((symbol) => test(\`quotes \${symbol}\`, () => {})));
describe('fees', () => {
  test('charges the minimum', () => {});
  return 42;
});
describe('venues', () => Promise.resolve());
describe('netting', () => test('nets two fills', () => {}));
describe('ledger', () => registerLedgerTests());
describe('custodian', () => new Promise((resolve) => resolve()));
describe('calendar', function () {
  return { holidays: [] };
});
describe('blotter', () => blotter.register());
describe('desk', () => class Desk {});
describe('venues by kind', () => registrars[kind]());
describe('venues held', () => venues);
`);
    const refusals = inventory.diagnostics.filter((item) => item.code.includes('describe'));
    expect(refusals.map((item) => [item.code, item.lineStart])).toEqual([
      ['describe-throws', 2],
      ['describe-throws', 3],
      ['async-describe', 7],
      ['async-describe', 10],
      ['describe-throws', 11],
      ['describe-throws', 15],
    ]);
    expect(inventory.tests.every((test) => test.state === 'notLoaded')).toBe(true);
  });

  it('reads the @jest/globals module required in place', () => {
    const inventory = scanJest(`
require('@jest/globals').test('settles a trade', () => {});
require('@jest/globals').describe.skip('trade desk', () => {
  test('books a fill', () => {});
  test.skip('books a refund', () => {});
});
require('@jest/globals').expect(1).toBe(1);
require('@jest/globals')();
`);
    expect(states(inventory)).toEqual([
      ['settles a trade', 'active', false],
      ['trade desk > books a fill', 'skip', false],
      ['trade desk > books a refund', 'skip', false],
    ]);
    expect(inventory.tests[2].stateSource).toBe('test');
  });

  it('reads a test function chosen with &&, || or ??', () => {
    const inventory = scanJest(`
const onCi = process.env.CI && test.skip || test;
const fallback = process.env.BROKER_TEST || test;
const parked = test.skip ?? test;
const chained = test && test.skip;
const either = process.env.CI ? test : process.env.FALLBACK && test.skip;
const neither = process.env.A || process.env.B;
const halfway = process.env.CI ? test : helperFor('desk');
onCi('settles a trade', () => {});
chained('voids a trade', () => {});
either('amends a trade', () => {});
neither('cancels a trade', () => {});
const both = process.env.A && process.env.B;
both('reprices a trade', () => {});
halfway('books a trade', () => {});
fallback('books a fill', () => {});
parked('nets a fill', () => {});
`);
    expect(states(inventory)).toEqual([
      ['settles a trade', 'active', false],
      ['voids a trade', 'skip', false],
      ['amends a trade', 'active', false],
      ['books a fill', 'active', false],
      ['nets a fill', 'skip', false],
    ]);
  });

  it('keeps a file loaded when a call Jest refuses is reached only under a condition', () => {
    const inventory = scanJest(`
if (process.env.LEGACY) {
  test.only.skip('books a fill', () => {});
  test('reads the old calendar');
}
test('settles a trade', () => {});
`);
    expect(codes(inventory)).toEqual(['invalid-chain', 'test-without-body']);
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([['settles a trade', 'active']]);
  });

  it('lists one failing test for .each without a body, and keeps the file loaded', () => {
    const inventory = scanJest(`
test.each([[1], [2]])('rounds %i lots');
test('settles a trade', () => {});
`);
    expect(inventory.tests.map((test) => [test.title, test.state, test.caseCount])).toEqual([
      ['rounds %i lots', 'active', 1],
      ['settles a trade', 'active', null],
    ]);
    expect(inventory.diagnostics.map((item) => [item.code, item.level, item.message])).toEqual([
      [
        'test-without-body',
        'warning',
        "test.each() has no test body, so Jest registers one test titled 'rounds %i lots' that always fails.",
      ],
    ]);
  });

  it('reports a describe.each with an empty or invalid table, which fails the file', () => {
    const inventory = scanJest(`
describe.each([])('venue %s', () => {
  test('settles a trade', () => {});
});
describe.each('NYSE')('exchange %s', () => {
  test('books a fill', () => {});
});
describe.each\`
  venue
\`('venue $venue', () => {
  test('nets a fill', () => {});
});
describe.each\`
  venue | days
  \${'NYSE'}
\`('venue $venue', () => {
  test('nets a cancel', () => {});
});
describe.each()('desk %s', () => {
  test('voids a trade', () => {});
});
describe.each(...desks)('desk %s', () => {
  test('amends a trade', () => {});
});
describe.each(DESKS)('desk %s', () => {
  test('cancels a trade', () => {});
});
`);
    expect(codes(inventory)).toEqual([
      'describe-throws',
      'describe-throws',
      'describe-throws',
      'describe-throws',
      'describe-throws',
      'unresolved-cases',
      'unresolved-cases',
    ]);
    expect(inventory.tests.every((test) => test.state === 'notLoaded')).toBe(true);
  });

  it('reports a second argument that is not a function, which fails the file', () => {
    const inventory = scanJest(`
test('kills the session', { timeout: 10_000 }, async () => {});
test('settles a trade', 5000, () => {});
describe('fees', {}, () => {
  test('charges the minimum', () => {});
});
`);
    expect(codes(inventory)).toEqual(['test-without-body', 'test-without-body', 'test-without-body']);
    expect(inventory.tests.every((test) => test.state === 'notLoaded')).toBe(true);
  });

  it('keeps the file loaded when the describe that throws is in a function nothing calls', () => {
    const inventory = scanJest(`
const legacyDeskTests = () => {
  describe('legacy desk', () => {
    describe.each([])('routes %s', (venue) => {
      test('fills an order', () => {});
    });
    venueTests('NYSE');
  });
};
function venueTests(venue) {
  describe(venue, () => {
    describe.each([])('routes %s', (side) => {
      test('nets a fill', () => {});
    });
  });
}
test('books the commission', () => {});
`);
    expect(inventory.tests.map((test) => [test.title, test.state])).toEqual([
      ['fills an order', 'active'],
      ['nets a fill', 'active'],
      ['books the commission', 'active'],
    ]);
    // venueTests is listed where it is written, so its describe keeps the parameter as its title.
    expect(codes(inventory)).toEqual([
      'describe-throws',
      'test-in-function',
      'dynamic-title',
      'describe-throws',
      'test-in-function',
    ]);
  });
});

describe('board follow-ups for the Jest release', () => {
  it('reports code the parser fails to hand over as a parse-error (TI-75)', () => {
    const code = "<\\u{2F804}></\\u{2F804}>;\ntest('books a fill', () => {});\n";
    const inventory = scanJest(code, { relativeFilePath: 'tests/markup.test.jsx' });
    expect(inventory.diagnostics.map((item) => [item.code, item.message])).toEqual([
      ['parse-error', 'The file could not be parsed: Bad Unicode escape in JSON at position 185 (line 2 column 177)'],
    ]);
  });

  it('counts a table or loop whose length is known when one of its values is not (TI-73)', () => {
    const inventory = scanJest(`
const SOURCES = [['List', List([1])], ['Set', makeSet()], ...[['Map', new Map()]]];
const HANDLERS = { onSubmit: () => submit(), onReset: () => reset() };
const LIMITS = [NaN, Infinity];
LIMITS.push(0);
it.each(SOURCES)('counts a %s', () => {});
[NaN, Infinity, -Infinity].forEach((price) => test(\`rejects \${price}\`, () => {}));
Object.entries(HANDLERS).forEach(([name]) => test(\`handles \${name}\`, () => {}));
for (const quote of [quoteOf('AAPL'), , quoteOf('MSFT')]) test('prices a quote', () => {});
for (const limit of LIMITS) test('checks a limit', () => {});
it.each(...tables)('spreads %s', () => {});
let SETTINGS = { lot: 100 };
const COPIED = { ...SETTINGS };
const COMPUTED = { [venueKey]: 'NYSE' };
const VENUES = { nyse: 1 };
VENUES.lse = 2;
const FIRST = SECOND;
const SECOND = FIRST;
for (const source of [Object.keys(SETTINGS), Object.keys(COPIED), Object.keys(COMPUTED), Object.keys(VENUES),
  Object.keys(FIRST), Object.keys(settingsOf()), Object.keys(...lists)]) {
  source.forEach(() => test('reads a setting', () => {}));
}
`);
    expect(inventory.tests.map((test) => [test.title, test.caseCount])).toEqual([
      ['counts a %s', 3],
      ['`rejects ${price}`', 3],
      ['`handles ${name}`', 2],
      ['prices a quote', 3],
      ['checks a limit', null],
      ['spreads %s', null],
      ['reads a setting', null],
    ]);
    const values = new Values();
    const program = parseFile(
      'settings.ts',
      `
let SETTINGS = { lot: 100 };
const COPIED = { ...SETTINGS };
const COMPUTED = { [venueKey]: 'NYSE' };
const VENUES = { nyse: 1 };
VENUES.lse = 2;
const FIRST = SECOND;
const SECOND = FIRST;
const HANDLERS = { onSubmit: () => submit() };
`,
    ).program;
    const count = (code: string) => {
      const [statement] = parseFile('count.ts', code).program.body;
      return statement.type === 'ExpressionStatement' ? values.lengthOf(statement.expression, [program]) : undefined;
    };
    expect(
      [
        'Object.keys(SETTINGS)',
        'Object.keys(COPIED)',
        'Object.keys(COMPUTED)',
        'Object.keys(VENUES)',
        'Object.keys(FIRST)',
        'Object.keys(settingsOf())',
        'Object.keys(...lists)',
        'Object.entries(HANDLERS)',
      ].map(count),
    ).toEqual([null, null, null, null, null, null, null, 1]);
  });

  it('titles a describe or test by a named function or class written in place (TI-74)', () => {
    const inventory = scanJest(`
describe(function OrderBook() {}, () => {
  test(class Matcher {}, () => {});
});
`);
    expect(inventory.tests.map((test) => test.fullName)).toEqual(['OrderBook > Matcher']);
    expect(codes(inventory)).toEqual([]);
  });

  it.each([
    'false',
    'null',
    '({venue: "paper"})',
    '["paper"]',
    '({venue: quote()})',
    '[quote()]',
    '/settlement/',
    '42n',
    'function () {}',
    'class {}',
    '() => {}',
  ])('marks the file as not loaded when Jest rejects title %s', (title) => {
    for (const callee of ['test', 'describe.skip.each(["bid", "ask"])']) {
      const result = scanJest(`test('opens the market', () => {});\n${callee}(${title}, () => {});`);
      expect(testNamed(result, 'opens the market').state).toBe('notLoaded');
      expect(codes(result)).toContain('invalid-chain');
    }
  });

  it('expands Jest titles using the declared function name, its inferred name, or undefined', () => {
    const result = scanJest(
      `
function settle() {}
const alias = settle;
const named = function postOrder() {};
const inferred = () => {};
const empty = undefined;
test.each([1, 2])(alias, () => {});
test(named, () => {});
describe.each([1, 2])(inferred, () => { test('settles the order', () => {}); });
test.each([1, 2])(empty, () => {});
test(void 0, () => {});
`,
      { expandCases: true },
    );
    expect(result.tests.map((t) => t.fullName)).toEqual([
      'settle',
      'settle',
      'postOrder',
      'inferred > settles the order',
      'inferred > settles the order',
      'undefined',
      'undefined',
      'undefined',
    ]);
    expect(codes(result)).not.toContain('dynamic-title');
  });

  it('requires a string title for Jest todo declarations and Jest 27 tests', () => {
    for (const [version, declaration] of [
      ['30.5.2', 'test.todo(42)'],
      ['30.5.2', 'function Orders() {} test.todo(Orders)'],
      ['30.5.2', 'test.todo(void 0)'],
      ['27.5.1', 'test(42, () => {})'],
      ['27.5.1', 'describe.each([1,2])(function Trades() {}, () => {})'],
    ]) {
      const result = scanJest(`test('opens the market', () => {});\n${declaration};`, { frameworkVersion: version });
      expect(testNamed(result, 'opens the market').state).toBe('notLoaded');
    }
    const legacy = scanJest("describe(function () {}, () => { test('posts the order', () => {}); });", {
      frameworkVersion: '27.5.1',
    });
    expect(onlyTest(legacy).state).toBe('active');
  });

  it('checks the ordinary describe callback before its title, and the table title before the callback', () => {
    for (const [call, code] of [
      ['describe(["bid"])', 'test-without-body'],
      ['describe(["bid"], 7)', 'test-without-body'],
      ['describe.each(["bid"])(false)', 'invalid-chain'],
    ]) {
      const result = scanJest(`test('opens the market', () => {});\n${call};`);
      expect(codes(result)).toEqual([code]);
      expect(testNamed(result, 'opens the market').state).toBe('notLoaded');
    }
  });
});

describe('helpers and values from other files', () => {
  const JEST = JSON.stringify({ devDependencies: { jest: '30.5.2' } });
  const scanned = async (files: Record<string, string>) => {
    const inventory = await scan({
      root: project({ 'package.json': JEST, ...files }),
      framework: 'jest',
      patterns: ['**/*.test.js'],
    });
    return {
      tests: inventory.tests.map((test) => [test.fullName, test.state, test.caseCount]),
      codes: codes(inventory),
      messages: inventory.diagnostics.map((item) => item.message),
    };
  };

  it('reads values and helper functions from files loaded with require() (TI-70)', async () => {
    const result = await scanned({
      'lib/symbols.js': "exports.SYMBOLS = ['AAPL', 'MSFT'];\nmodule.exports.VENUES = ['XNAS'];\n",
      'lib/limits.json': '{ "lots": [1, 10, 100] }',
      'lib/helpers.js': `function registerSettlement(desk) {
  describe(\`\${desk} settlement\`, () => {
    test('books the cash leg', () => {});
  });
}
module.exports = { registerSettlement };
`,
      'lib/clearing.js':
        'module.exports = function registerClearing(desk) {\n  test(`clears ${desk}`, () => {});\n};\n',
      'tests/settle.test.js': `const { SYMBOLS } = require('../lib/symbols');
const registerClearing = require('../lib/clearing');
const symbols = require('../lib/symbols');
const { lots } = require('../lib/limits.json');
const { registerSettlement } = require('../lib/helpers');
test.each(SYMBOLS)('settles %s', () => {});
test.each(symbols.VENUES)('routes to %s', () => {});
test.each(lots)('rounds %i lots', () => {});
registerSettlement('equities');
registerClearing('futures');
`,
    });
    expect(result.tests).toEqual([
      ['settles %s', 'active', 2],
      ['routes to %s', 'active', 1],
      ['rounds %i lots', 'active', 3],
      ['equities settlement > books the cash leg', 'active', null],
      ['clears futures', 'active', null],
    ]);
    expect(result.codes).toEqual([]);
  });

  it('follows a helper function written into module.exports, and not a name the module leaves out', async () => {
    const result = await scanned({
      'lib/helpers.js': `module.exports = {
  registerSettlement(desk) {
    test(\`settles \${desk}\`, () => {});
  },
  registerClearing: (desk) => test(\`clears \${desk}\`, () => {}),
};
`,
      'tests/settle.test.js': `const { registerSettlement, registerClearing, registerNetting } = require('../lib/helpers');
registerSettlement('equities');
registerClearing('futures');
registerNetting('rates');
`,
    });
    expect(result.tests).toEqual([
      ['settles equities', 'active', null],
      ['clears futures', 'active', null],
    ]);
    expect(result.codes).toEqual([]);
  });

  it('reads the names it can from a require(), destructured or not, and not the ones it cannot read', async () => {
    const result = await scanned({
      'lib/symbols.js':
        "const SYMBOLS = ['AAPL', 'MSFT'];\nexports.SYMBOLS = SYMBOLS;\nexports.VENUES = [['XNAS', 'XNYS']];\n",
      'lib/limits.js':
        "'use strict';\nexports.TICK = 0.01;\nconst TICK = readTick();\nexports.LOTS = [1, 10];\nexports.TICK = TICK;\n",
      'tests/route.test.js': `const { SYMBOLS, VENUES: [venues], ...rest } = require('../lib/symbols');
const limits = require('../lib/limits');
test.each(SYMBOLS)('routes %s', () => {});
test.each(venues)('quotes on %s', () => {});
test.each(rest.SYMBOLS)('books %s', () => {});
test.each(limits.LOTS)('rounds %i lots', () => {});
test(\`ticks at \${limits.TICK}\`, () => {});
const symbols = require('../lib/symbols');
test.each(Object.keys(symbols))('lists %s', () => {});
test.each(Object.values(limits))('caps %s', () => {});
`,
    });
    expect(result.tests).toEqual([
      ['routes %s', 'active', 2],
      ['quotes on %s', 'active', null],
      ['books %s', 'active', null],
      ['rounds %i lots', 'active', 2],
      ['`ticks at ${limits.TICK}`', 'active', null],
      ['lists %s', 'active', 2],
      ['caps %s', 'active', null],
    ]);
  });

  it('reads a test function a helper takes from the framework namespace, and none it hides, misnames or cannot follow', async () => {
    const result = await scanned({
      'helpers/tests.js': `const it = (title, fn) => fn();
export const settlementTest = it;
export const brokerTest = test.extend();
`,
      'helpers/globals.js':
        "import * as globals from '@jest/globals';\nexport const pendingTest = globals.xit;\nexport const quoteTest = globals.quote;\n",
      'helpers/focused.js': "const mode = 'only';\nexport default test[mode];\n",
      'tests/settle.test.js':
        "import { settlementTest } from '../helpers/tests';\nsettlementTest('settles a trade', () => {});\n",
      'tests/focus.test.js':
        "import focusedTest from '../helpers/focused';\nfocusedTest('amends a trade', () => {});\n",
      'tests/broker.test.js':
        "import { brokerTest } from '../helpers/tests';\nbrokerTest('voids a trade', () => {});\n",
      'tests/quote.test.js':
        "import { pendingTest, quoteTest } from '../helpers/globals';\npendingTest('quotes a spread', () => {});\nquoteTest('quotes a price', () => {});\n",
    });
    expect(result.tests).toEqual([['quotes a spread', 'skip', null]]);
    expect(result.messages).toEqual([
      "'brokerTest' is imported from '../helpers/tests', which builds it with test.extend(), which is not followed; tests that use it are missing.",
      "'quoteTest' is imported from '../helpers/globals', which does not export a Jest test object that could be recognized; tests that use it are missing.",
    ]);
  });

  it('follows a helper a file imports and exports again (TI-71)', async () => {
    const result = await scanned({
      'shared/rootPropsTest.js': `import { describe, it } from '@jest/globals';
export default function rootPropsTest(component) {
  describe('root props', () => {
    it(\`passes props to \${component}\`, () => {});
  });
}
`,
      'shared/demoTest.js':
        "import rootPropsTest from './rootPropsTest';\nexport { rootPropsTest };\nexport default rootPropsTest;\n",
      'components/button.test.js': "import { rootPropsTest } from '../shared/demoTest';\nrootPropsTest('button');\n",
      'components/select.test.js': "import venueTests from '../shared/demoTest';\nvenueTests('select');\n",
    });
    expect(result.tests).toEqual([
      ['root props > passes props to button', 'active', null],
      ['root props > passes props to select', 'active', null],
    ]);
    expect(result.codes).toEqual([]);
  });

  it('does not report a re-exported helper called like a test as a broken import (TI-71)', async () => {
    const result = await scanned({
      'shared/settlementTest.js': 'export default function settlementTest(title, body) {\n  test(title, body);\n}\n',
      'shared/index.js': "import settlementTest from './settlementTest';\nexport { settlementTest };\n",
      'tests/settle.test.js':
        "import { settlementTest } from '../shared';\nsettlementTest('settles equities', () => {});\n",
    });
    expect(result.tests).toEqual([['settles equities', 'active', null]]);
    expect(result.codes).toEqual([]);
  });

  it('does not report a describe in a helper named like a test as nested in a test (TI-77)', async () => {
    const result = await scanned({
      'shared/settlement.js':
        "export default function settlementTest(desk, body) {\n  describe(desk, () => { test('settles', body); });\n}\n",
      'tests/settle.test.js':
        "import settlementTest from '../shared/settlement';\nsettlementTest('equities', () => {});\n",
    });
    expect(result.tests).toEqual([['equities > settles', 'active', null]]);
    expect(result.codes).toEqual([]);
  });

  it('reads a test function a helper takes from the globals, with its modifiers (TI-69)', async () => {
    const result = await scanned({
      'helpers/tests.js':
        'export const test = it;\nexport const skipTest = it.skip;\nexport const pendingBrokerTest = xit;\n',
      'tests/broker.test.js': `import { test, skipTest, pendingBrokerTest } from '../helpers/tests';
test('settles a trade', () => {});
skipTest('amends a trade', () => {});
pendingBrokerTest('voids a trade', () => {});
`,
    });
    expect(result.tests).toEqual([
      ['settles a trade', 'active', null],
      ['amends a trade', 'skip', null],
      ['voids a trade', 'skip', null],
    ]);
    expect(result.codes).toEqual([]);
  });
});
