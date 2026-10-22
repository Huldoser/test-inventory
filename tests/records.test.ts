import { createHash } from 'node:crypto';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { scan, type SuiteRecord, type TestRecord } from '../src/index.ts';
import { duplicateIdDiagnostics } from '../src/records.ts';
import { codes, onlyTest, PLAYWRIGHT_IMPORT, scanPlaywright, scanVitest, testNamed, VITEST_IMPORT } from './helpers.ts';
import { PLAYWRIGHT_PACKAGE, project } from './project.ts';

function sha16(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

describe('ids', () => {
  it('hashes the file path, describe titles and title without tags, and the position among equal titles', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('orders @orders', () => {
  test('fills @smoke', async () => {});
  test('fills', async () => {});
});
`);
    expect(inventory.tests.map((test) => test.id)).toEqual([
      sha16(['tests/orders.spec.ts', ['orders'], 'fills', 0]),
      sha16(['tests/orders.spec.ts', ['orders'], 'fills', 1]),
    ]);
    expect(inventory.suites[0].id).toBe(sha16(['tests/orders.spec.ts', 'describe', [], 'orders', 0]));
  });

  it('keeps ids when tests move to other lines', () => {
    const before = scanPlaywright(`${PLAYWRIGHT_IMPORT}\ntest('cancels an order', async () => {});`);
    const after = scanPlaywright(`${PLAYWRIGHT_IMPORT}\n\n\n// moved down\ntest('cancels an order', async () => {});`);
    expect(onlyTest(after).id).toBe(onlyTest(before).id);
    expect(onlyTest(after).lineStart).not.toBe(onlyTest(before).lineStart);
  });

  it('keeps tests in two describes with the same title apart, and reports them as Playwright rejects the file', () => {
    const code = `
describe('alerts', () => {
  test('creates an alert', async () => {});
});
describe('alerts', () => {
  test('creates an alert', async () => {});
});
`;
    const inventory = scanPlaywright(
      `${PLAYWRIGHT_IMPORT}\nconst { describe } = test;\n${code}`.replace(/^describe/gm, 'test.describe'),
    );
    const [first, second] = inventory.tests;
    expect(first.id).not.toBe(second.id);
    expect(first.suiteId).toBe(inventory.suites[0].id);
    expect(second.suiteId).toBe(inventory.suites[1].id);
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'duplicate-title',
        level: 'error',
        message:
          'Another test in the file has the same title path, so Playwright fails to load the file and runs no tests at all.',
        testId: second.id,
      },
    ]);
    // Vitest runs both, so it is only a duplicate within one describe, and a warning.
    expect(codes(scanVitest(`${VITEST_IMPORT}\n${code}`))).toEqual([]);
    const vitest = scanVitest(`${VITEST_IMPORT}
describe('alerts', () => {
  test('creates an alert', () => {});
  test('creates an alert', () => {});
});
`);
    expect(vitest.diagnostics).toMatchObject([
      { code: 'duplicate-title', level: 'warning', message: 'Another test in the same describe has the same title.' },
    ]);
  });

  it('reports a Playwright duplicate across an anonymous describe, which Playwright leaves out of the title', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('creates an alert', async () => {});
test.describe(() => {
  test('creates an alert', async () => {});
});
`);
    expect(inventory.diagnostics).toMatchObject([{ code: 'duplicate-title', level: 'error', lineStart: 4 }]);
  });

  it('links suites to their parents and tests to their nearest describe', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('signs in', async () => {});
test.describe('portfolio', () => {
  test.describe('positions', () => {
    test('closes a position', async () => {});
  });
});
`);
    const [portfolio, positions] = inventory.suites;
    expect(portfolio.parentId).toBeNull();
    expect(positions.parentId).toBe(portfolio.id);
    expect(inventory.tests.map((test) => [test.suiteId, test.suitePath])).toEqual([
      [null, []],
      [positions.id, ['portfolio', 'positions']],
    ]);
  });

  it('reports each id used twice, which only a hash collision can cause', () => {
    expect(duplicateIdDiagnostics([{ id: 'a1' }, { id: 'b2' }, { id: 'a1' }, { id: 'a1' }], 'tests/a.spec.ts')).toEqual(
      [
        {
          code: 'duplicate-id',
          level: 'error',
          message: 'Two records in the file have the id a1.',
          relativeFilePath: 'tests/a.spec.ts',
          lineStart: null,
          columnStart: null,
          testId: null,
          source: 'a1',
        },
      ],
    );
    expect(duplicateIdDiagnostics([{ id: 'a1' }], 'tests/a.spec.ts')).toEqual([]);
  });
});

describe('body hashes', () => {
  it('ignore formatting, comments and line endings in the test body', async () => {
    const compact = `${PLAYWRIGHT_IMPORT}\ntest('fills', async ({ orderTicket }) => { await orderTicket.buy({ symbol: "AAPL", quantity: 5, note: \`scaling in\nslowly\` }) });`;
    const formatted = await format(compact.replace('async ({', '// five shares is enough\nasync ({'), {
      parser: 'typescript',
      printWidth: 60,
    });
    const hash = onlyTest(scanPlaywright(compact)).bodyHash;
    expect(onlyTest(scanPlaywright(formatted)).bodyHash).toBe(hash);
    expect(onlyTest(scanPlaywright(formatted.replaceAll('\n', '\r\n'))).bodyHash).toBe(hash);
  });

  it('hash a function declared in the file and passed by name, and are null for one from elsewhere', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { checkFromElsewhere } from './checks';
async function checkFill({ page }) {
  await page.getByRole('button', { name: 'Buy' }).click();
}
test('fills a market order', checkFill);
test('fills a limit order', checkFromElsewhere);
test('fills a stop order', async ({ page }) => {
  await page.getByRole('button', { name: 'Buy' }).click();
});
`);
    expect(inventory.tests.map((test) => test.bodyHash === null)).toEqual([false, true, false]);
  });

  it('change when the code changes', () => {
    const five = scanPlaywright(`${PLAYWRIGHT_IMPORT}\ntest('fills', async ({ t }) => { await t.buy(5); });`);
    const six = scanPlaywright(`${PLAYWRIGHT_IMPORT}\ntest('fills', async ({ t }) => { await t.buy(6); });`);
    expect(onlyTest(five).bodyHash).not.toBe(onlyTest(six).bodyHash);
  });

  it('cover only a describe’s own code, null when it holds only tests', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('orders', () => {
  test.describe('limit', () => {
    test.beforeEach(async ({ orderTicket }) => {
      await orderTicket.open('AAPL');
    });
    test('fills', async () => {});
  });
});
test.describe('alerts', () => test('creates', async () => {}));
`);
    const withOtherTest = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('orders', () => {
  test.describe('limit', () => {
    test.beforeEach(async ({ orderTicket }) => {
      await orderTicket.open('AAPL');
    });
    test('cancels', async () => {});
  });
});
`);
    expect(inventory.suites.map((suite) => suite.bodyHash === null)).toEqual([true, false, true]);
    expect(withOtherTest.suites[1].bodyHash).toBe(inventory.suites[1].bodyHash);
  });
});

describe('effective state', () => {
  it('lets a skipped describe win over a test’s own expected failure, as both runners do', () => {
    const playwright = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe.skip('options trading', () => {
  test.fail('prices a call', async () => {});
});
`);
    const vitest = scanVitest(`${VITEST_IMPORT}
describe.skip('options trading', () => {
  test.fails('prices a call', () => {});
  test.todo('prices a straddle');
});
`);
    expect(onlyTest(playwright)).toMatchObject({ state: 'skip', stateSource: 'suite' });
    expect(vitest.tests.map((test) => [test.state, test.stateSource])).toEqual([
      ['skip', 'suite'],
      ['todo', 'test'],
    ]);
  });

  it('keeps the test’s own state over a describe’s', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe.skip('options trading', () => {
  test.fixme('prices a call', async () => {});
  test('prices a put', async () => {});
});
`);
    expect(inventory.tests.map((test) => [test.state, test.stateSource])).toEqual([
      ['fixme', 'test'],
      ['skip', 'suite'],
    ]);
    expect(inventory.suites[0].isSkipped).toBe(true);
  });

  it('lets a state that always applies win over a conditional one', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe.fixme('margin', () => {
  test('shows the requirement', async ({ browserName }) => {
    test.skip(browserName === 'webkit');
  });
});
test.describe('reports', () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe('daily', () => {
    test.fixme(({ browserName }) => browserName === 'firefox');
    test('builds the report', async () => {});
  });
});
`);
    expect(inventory.tests.map((test) => [test.state, test.condition, test.stateSource])).toEqual([
      ['fixme', null, 'suite'],
      ['fixme', "browserName === 'firefox'", 'suite'],
    ]);
    expect(inventory.suites[2]).toMatchObject({ isFixme: true, isConditional: true });
  });

  it('marks .only on a describe on every test inside it', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe.only('watchlist', () => {
  test.skip('sorts by change', async () => {});
});
`);
    expect(onlyTest(inventory)).toMatchObject({ state: 'skip', isOnly: true });
    expect(inventory.summary.onlyCount).toBe(1);
  });

  it('reports .only inside a skipped describe', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe.skip('crypto', () => {
  test.only('buys bitcoin', async () => {});
});
`);
    expect(onlyTest(inventory)).toMatchObject({ state: 'skip', isOnly: true });
    expect(inventory.diagnostics).toMatchObject([{ code: 'only-in-skipped-describe', level: 'warning', lineStart: 3 }]);
  });
});

describe('comments', () => {
  const code = `${PLAYWRIGHT_IMPORT}
const PAPER = true; // trailing comment, not above the test

/**
 * FIXME: TRD-301 the one-time code screen
 *   is behind a feature flag
 */
// SKIP: staging only
test.fixme('asks for a one-time code', async () => {});

// Unrelated note

test('signs in', async () => {});
`;

  it('reads the comment lines directly above tests that are not active', () => {
    const inventory = scanPlaywright(code);
    expect(inventory.tests.map((test) => test.comments)).toEqual([
      ['FIXME: TRD-301 the one-time code screen', 'is behind a feature flag', 'SKIP: staging only'],
      [],
    ]);
  });

  it('reads them for every test with all, and for none with none', () => {
    expect(scanPlaywright(code, { comments: 'all' }).tests.map((test) => test.comments.length)).toEqual([3, 0]);
    expect(scanPlaywright(code, { comments: 'none' }).tests.map((test) => test.comments.length)).toEqual([0, 0]);
  });

  it('leaves out lint, compiler, formatter and coverage directives', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
// TODO(TRD-731): the date picker is being rebuilt
// eslint-disable-next-line playwright/no-skipped-test
// @ts-expect-error the fixture is not typed yet
/* prettier-ignore */
/* istanbul ignore next */
// v8 ignore next
// c8 ignore next
test.skip('submits a good-till-date order', async () => {});
`);
    expect(onlyTest(inventory).comments).toEqual(['TODO(TRD-731): the date picker is being rebuilt']);
  });

  it('stops at a comment that ends a line of code or is separated by a blank line', () => {
    const inventory = scanPlaywright(
      `${PLAYWRIGHT_IMPORT}
setup(); // not about the test
test.skip('closes a position', async () => {});
`,
    );
    expect(onlyTest(inventory).comments).toEqual([]);
  });
});

describe('inherited values', () => {
  it('adds tags, annotations and locks from describes, outermost first, without duplicates', () => {
    const test = onlyTest(
      scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('orders @orders', { annotation: { type: 'area', description: 'trading' }, lock: 'broker' }, () => {
  test.describe('stops', { tag: ['@risk', '@orders'] }, () => {
    test('triggers a stop @risk', { lock: 'broker', annotation: { type: 'issue', description: 'TRD-9' } }, async () => {});
  });
});
`),
    );
    expect(test.tags).toEqual(['@orders', '@risk']);
    expect(test.annotations.map((annotation) => annotation.type)).toEqual(['area', 'issue']);
    expect(test.locks).toEqual(['broker']);
  });
});

describe('files and hooks', () => {
  const NO_HOOKS = { beforeAll: 0, beforeEach: 0, afterEach: 0, afterAll: 0, aroundEach: 0, aroundAll: 0 };

  it('counts the hooks of the file, of each describe, and of everything around each test', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.beforeAll(async () => {});
test.beforeEach(async ({ page }) => {});
test.describe('orders', () => {
  test.beforeEach('open the ticket', async ({ page }) => {});
  test.afterEach(async () => {});
  test('fills a market order', async () => {});
  test.describe('stops', () => {
    test.afterAll(async () => {});
    test('triggers a stop', async () => {});
  });
});
test('shows the watchlist', async () => {});
`);
    expect(inventory.files).toStrictEqual([
      {
        relativeFilePath: 'tests/orders.spec.ts',
        fileName: 'orders.spec.ts',
        hooks: { ...NO_HOOKS, beforeAll: 1, beforeEach: 1 },
        suiteCount: 2,
        testCount: 3,
      },
    ]);
    expect(inventory.suites.map((suite) => suite.hooks)).toEqual([
      { ...NO_HOOKS, beforeEach: 1, afterEach: 1 },
      { ...NO_HOOKS, afterAll: 1 },
    ]);
    expect(testNamed(inventory, 'fills a market order').hooks).toEqual({
      ...NO_HOOKS,
      beforeAll: 1,
      beforeEach: 2,
      afterEach: 1,
    });
    expect(testNamed(inventory, 'triggers a stop').hooks).toEqual({
      ...NO_HOOKS,
      beforeAll: 1,
      beforeEach: 2,
      afterEach: 1,
      afterAll: 1,
    });
    expect(testNamed(inventory, 'shows the watchlist').hooks).toEqual({ ...NO_HOOKS, beforeAll: 1, beforeEach: 1 });
  });

  it("counts Vitest's around hooks and the hooks on an extended test", () => {
    const inventory = scanVitest(`import { aroundAll, aroundEach, beforeEach, describe, test } from 'vitest';
const brokerTest = test.extend({ broker: async ({}, use) => use({}) });
aroundAll(async (run) => run());
describe('broker', () => {
  aroundEach(async (run) => run());
  brokerTest.beforeEach(({ broker }) => {});
  beforeEach(() => {});
  brokerTest('reconnects after a drop', ({ broker }) => {});
});
`);
    expect(inventory.files[0].hooks).toEqual({ ...NO_HOOKS, aroundAll: 1 });
    expect(onlyTest(inventory).hooks).toEqual({ ...NO_HOOKS, beforeEach: 2, aroundEach: 1, aroundAll: 1 });
  });

  it('counts hooks a helper registers where it is called, and none for a helper never called', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
function signIn() {
  test.beforeEach(async ({ page }) => {});
}
function unused() {
  test.afterEach(async () => {});
}
test.describe('portfolio', () => {
  signIn();
  test('lists positions', async () => {});
});
`);
    expect(inventory.files[0].hooks).toEqual(NO_HOOKS);
    expect(inventory.suites[0].hooks).toEqual({ ...NO_HOOKS, beforeEach: 1 });
    expect(onlyTest(inventory).hooks).toEqual({ ...NO_HOOKS, beforeEach: 1 });
  });

  it('counts hooks in functions without a name where they are written, as their tests are', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { withMarketOpen } from 'market-kit';
test.describe('orders', () => {
  (() => {
    test.beforeEach(async ({ page }) => {});
  })();
  withMarketOpen(() => {
    test.afterEach(async () => {});
    test('fills a market order', async () => {});
  });
});
`);
    expect(inventory.suites[0].hooks).toEqual({ ...NO_HOOKS, beforeEach: 1, afterEach: 1 });
    expect(onlyTest(inventory).hooks).toEqual({ ...NO_HOOKS, beforeEach: 1, afterEach: 1 });
  });

  it('has a record for a file without tests or that fails to parse', () => {
    const inventory = scanVitest('describe(');
    expect(inventory.files).toStrictEqual([
      {
        relativeFilePath: 'tests/orders.test.ts',
        fileName: 'orders.test.ts',
        hooks: NO_HOOKS,
        suiteCount: 0,
        testCount: 0,
      },
    ]);
  });
});

describe('run settings', () => {
  const NOT_SET = {
    timeout: null,
    isSlow: false,
    slowCondition: null,
    retries: null,
    retryDelay: null,
    retryCondition: null,
    repeats: null,
  };
  const settings = (record: SuiteRecord | TestRecord) => ({
    timeout: record.timeout,
    isSlow: record.isSlow,
    slowCondition: record.slowCondition,
    retries: record.retries,
    retryDelay: record.retryDelay,
    retryCondition: record.retryCondition,
    repeats: record.repeats,
  });

  it("takes Playwright's timeout and retries from the nearest describe that sets each", () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.setTimeout(45_000);
test.describe('market data', () => {
  test.describe.configure({ retries: 2 });
  test('streams quotes', async () => {});
  test.describe('depth of book', () => {
    test.describe.configure({ timeout: 90_000 });
    test('shows ten levels', async () => {});
  });
});
test('shows the watchlist', async () => {});
`);
    expect(inventory.suites.map(settings)).toEqual([
      { ...NOT_SET, retries: 2 },
      { ...NOT_SET, timeout: 90_000 },
    ]);
    expect(settings(testNamed(inventory, 'streams quotes'))).toEqual({ ...NOT_SET, timeout: 45_000, retries: 2 });
    expect(settings(testNamed(inventory, 'shows ten levels'))).toEqual({ ...NOT_SET, timeout: 90_000, retries: 2 });
    expect(settings(testNamed(inventory, 'shows the watchlist'))).toEqual({ ...NOT_SET, timeout: 45_000 });
  });

  it('lets a Playwright setTimeout() in the test body or a beforeEach win over the describe, but not one in beforeAll', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('backtests', () => {
  test.describe.configure({ timeout: 60_000 });
  test.beforeAll(async () => {
    test.setTimeout(300_000);
  });
  test.beforeEach(async () => {
    test.setTimeout(120_000);
  });
  test('replays a trading day', async () => {});
  test('replays a trading year', async () => {
    test.setTimeout(600_000);
  });
});
`);
    expect(settings(inventory.suites[0])).toEqual({ ...NOT_SET, timeout: 60_000 });
    expect(testNamed(inventory, 'replays a trading day').timeout).toBe(120_000);
    expect(testNamed(inventory, 'replays a trading year').timeout).toBe(600_000);
  });

  it("reads Playwright's test.slow() with and without a condition", () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('charts', () => {
  test.slow(({ browserName }) => browserName === 'webkit', 'Charts render slowly on WebKit');
  test('draws candles', async () => {});
  test('draws a year of candles', async () => {
    test.slow();
  });
  test('draws a sparkline', async () => {
    test.slow(false);
  });
});
test('exports a chart image', async ({ browserName }) => {
  if (browserName === 'firefox') test.slow();
});
`);
    expect(settings(inventory.suites[0])).toEqual({
      ...NOT_SET,
      isSlow: true,
      slowCondition: "browserName === 'webkit'",
    });
    expect(testNamed(inventory, 'draws candles')).toMatchObject({
      isSlow: true,
      slowCondition: "browserName === 'webkit'",
    });
    expect(testNamed(inventory, 'draws a year of candles')).toMatchObject({ isSlow: true, slowCondition: null });
    expect(testNamed(inventory, 'exports a chart image')).toMatchObject({
      isSlow: true,
      slowCondition: "browserName === 'firefox'",
    });
    expect(testNamed(inventory, 'draws a sparkline')).toMatchObject({
      isSlow: true,
      slowCondition: "browserName === 'webkit'",
    });
  });

  it('warns about a timeout it cannot work out or that is set only sometimes, and keeps the one around it', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { ORDER_TIMEOUT } from './timeouts';
test.describe('orders', () => {
  test.describe.configure({ timeout: 60_000 });
  test('fills a market order', async () => {
    test.setTimeout(ORDER_TIMEOUT);
  });
  test('fills a limit order', async ({ browserName }) => {
    if (browserName === 'webkit') test.setTimeout(120_000);
  });
});
`);
    const [market, limit] = inventory.tests;
    expect([market.timeout, limit.timeout]).toEqual([60_000, 60_000]);
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'unresolved-option',
        level: 'warning',
        message:
          "Option timeout: ORDER_TIMEOUT comes from './timeouts' and could not be worked out; it is not applied.",
        testId: market.id,
      },
      {
        code: 'unresolved-option',
        level: 'warning',
        message: "Option timeout: 120_000 is set only when browserName === 'webkit'; it is not applied.",
        testId: limit.id,
      },
    ]);
  });

  it('warns about a describe timeout it cannot work out, with no test to point at', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { BACKTEST_TIMEOUT } from './timeouts';
test.describe('backtests', () => {
  test.setTimeout(BACKTEST_TIMEOUT);
  test('replays a trading day', async () => {});
});
`);
    expect(onlyTest(inventory).timeout).toBeNull();
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'unresolved-option',
        message:
          "Option timeout: BACKTEST_TIMEOUT comes from './timeouts' and could not be worked out; it is not applied.",
        lineStart: 4,
        testId: null,
      },
    ]);
  });

  it('applies test.slow() from a helper where the helper is called', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
function slowOnWebKit() {
  test.slow(({ browserName }) => browserName === 'webkit');
}
test.describe('charts', () => {
  slowOnWebKit();
  test('draws candles', async () => {});
});
test('draws a sparkline', async () => {});
`);
    expect(testNamed(inventory, 'draws candles')).toMatchObject({
      isSlow: true,
      slowCondition: "browserName === 'webkit'",
    });
    expect(testNamed(inventory, 'draws a sparkline').isSlow).toBe(false);
  });

  it('applies settings from a helper called in a test body or a beforeEach, with the conditions around the call', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
function slowOnCI() {
  test.slow();
  test.setTimeout(7_000);
}
test('fills a stop order', async () => {
  slowOnCI();
});
test.describe('quotes', () => {
  test.beforeEach(async () => {
    slowOnCI();
  });
  test('streams quotes', async () => {});
});
test('streams depth', async ({ browserName }) => {
  if (browserName === 'webkit') slowOnCI();
});
test.describe('fills', () => {
  test.afterEach(async () => {
    slowOnCI();
  });
  test('streams fills', async () => {});
});
`);
    expect(testNamed(inventory, 'fills a stop order')).toMatchObject({ timeout: 7_000, isSlow: true });
    expect(testNamed(inventory, 'streams quotes')).toMatchObject({ timeout: 7_000, isSlow: true });
    expect(testNamed(inventory, 'streams fills')).toMatchObject({ timeout: null, isSlow: false });
    expect(testNamed(inventory, 'streams depth')).toMatchObject({
      timeout: null,
      isSlow: true,
      slowCondition: "browserName === 'webkit'",
    });
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'unresolved-option',
        message: "Option timeout: 7_000 is set only when browserName === 'webkit'; it is not applied.",
        testId: testNamed(inventory, 'streams depth').id,
      },
    ]);
  });

  it('warns once about a timeout in a helper it cannot work out, where the helper is written', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
import { FILL_TIMEOUT } from './timeouts';
function waitForFills() {
  test.setTimeout(FILL_TIMEOUT);
}
test('streams fills', async () => {
  waitForFills();
});
test('streams partial fills', async () => {
  waitForFills();
});
`);
    expect(inventory.tests.map((test) => test.timeout)).toEqual([null, null]);
    expect(inventory.diagnostics).toMatchObject([
      {
        code: 'unresolved-option',
        message: "Option timeout: FILL_TIMEOUT comes from './timeouts' and could not be worked out; it is not applied.",
        lineStart: 4,
        testId: null,
      },
    ]);
  });

  it('applies a timeout from a beforeEach that a helper registers where the helper is called', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
function allowSlowFills() {
  test.beforeEach(async () => {
    test.setTimeout(45_000);
  });
}
test.describe('fills', () => {
  allowSlowFills();
  test('streams fills', async () => {});
});
`);
    expect(onlyTest(inventory).timeout).toBe(45_000);
  });

  it('keeps every condition of the test.slow() calls that apply', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('orders', () => {
  test.slow(({ browserName }) => browserName === 'webkit');
  test('cancels every open order', async () => {
    if (process.env.CI) test.slow();
    if (process.env.NIGHTLY) test.slow(process.platform === 'win32');
    test.slow(process.env.SLOW_DISK ?? process.platform === 'darwin');
  });
});
`);
    expect(onlyTest(inventory).slowCondition).toBe(
      "process.env.CI || process.env.NIGHTLY && process.platform === 'win32' || (process.env.SLOW_DISK ?? process.platform === 'darwin') || browserName === 'webkit'",
    );
  });

  it('leaves the timeout alone for test.setTimeout() without a number', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
const limits = [90_000];
test.describe('backtests', () => {
  test.setTimeout();
  test.setTimeout(...limits);
  test('replays a trading day', async () => {});
});
`);
    expect(onlyTest(inventory).timeout).toBeNull();
    expect(inventory.diagnostics).toEqual([]);
  });

  it('reads Vitest timeout, retry and repeats options, with describes passing theirs down', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
describe('broker connection', { retry: { count: 3, delay: 500, condition: /ECONNRESET/ }, timeout: 10_000 }, () => {
  test('reconnects after a drop', () => {});
  test('gives up after the session ends', { retry: 1 }, () => {});
  test('replays missed fills', () => {}, 30_000);
});
test('matches orders under load', { repeats: 20 }, () => {});
`);
    expect(settings(inventory.suites[0])).toEqual({
      ...NOT_SET,
      timeout: 10_000,
      retries: 3,
      retryDelay: 500,
      retryCondition: '/ECONNRESET/',
    });
    expect(settings(testNamed(inventory, 'reconnects after a drop'))).toEqual(settings(inventory.suites[0]));
    expect(settings(testNamed(inventory, 'gives up after the session ends'))).toEqual({
      ...NOT_SET,
      timeout: 10_000,
      retries: 1,
    });
    expect(testNamed(inventory, 'replays missed fills')).toMatchObject({ timeout: 30_000, retries: 3 });
    expect(settings(testNamed(inventory, 'matches orders under load'))).toEqual({ ...NOT_SET, repeats: 20 });
  });

  it('warns about a Vitest retry it cannot work out, and reads a retry object without a count as no retries', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
import { RECONNECTS } from './broker';
test('reconnects after a drop', { retry: RECONNECTS }, () => {});
test('reconnects after a timeout', { retry: { count: RECONNECTS, delay: 250 } }, () => {});
test('reconnects after a restart', { retry: { delay: 250 } }, () => {});
`);
    expect(inventory.tests.map((test) => [test.retries, test.retryDelay, test.retryCondition])).toEqual([
      [null, null, null],
      [null, null, null],
      [0, 250, null],
    ]);
    expect(inventory.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Option retry: RECONNECTS comes from './broker' and could not be worked out; it is not applied.",
      "Option retry.count: RECONNECTS comes from './broker' and could not be worked out; it is not applied.",
    ]);
  });

  it('ignores the Vitest retry object before 4.1, where the runner does not retry with it', () => {
    const code = `${VITEST_IMPORT}\ntest('reconnects after a drop', { retry: { count: 3 } }, () => {});`;
    expect(onlyTest(scanVitest(code, { frameworkVersion: '4.0.0' })).retries).toBeNull();
    expect(onlyTest(scanVitest(code, { frameworkVersion: '4.1.0' })).retries).toBe(3);
  });
});

describe('summary', () => {
  it('counts tests with the same definitions as their booleans, tags and annotations sorted', () => {
    const inventory = scanVitest(`${VITEST_IMPORT}
describe.concurrent('fees', { tags: ['fees'] }, () => {
  test.skip('adds the exchange fee', { tags: ['exchange', 'fees'] }, () => {});
  test.todo('charges a borrow fee');
  test.fails('rounds a half cent up', () => {});
  test.each([[1], [2]])('charges %d', () => {});
  if (process.env.FULL) test.skipIf(isCI)('checks every broker', () => {});
});
`);
    expect(inventory.summary).toEqual({
      fileCount: 1,
      suiteCount: 1,
      testCount: 5,
      activeCount: 1,
      skipCount: 2,
      fixmeCount: 0,
      todoCount: 1,
      expectedToFailCount: 1,
      notLoadedCount: 0,
      onlyCount: 0,
      conditionalCount: 1,
      parallelCount: 5,
      serialCount: 0,
      parameterizedCount: 1,
      inLoopCount: 0,
      inConditionCount: 1,
      inFunctionCount: 0,
      typeTestCount: 0,
      diagnosticCount: 1,
      tagCounts: { exchange: 1, fees: 5 },
      annotationCounts: {},
    });
    expect(testNamed(inventory, 'adds the exchange fee').tags).toEqual(['fees', 'exchange']);
  });

  it('sorts tag and annotation counts by name', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test('b @smoke', { annotation: [{ type: 'issue' }, { type: 'issue' }, { type: 'flaky' }] }, async () => {});
test('a @orders @smoke', async () => {});
`);
    expect(Object.keys(inventory.summary.tagCounts)).toEqual(['@orders', '@smoke']);
    expect(inventory.summary.annotationCounts).toEqual({ flaky: 1, issue: 1 });
  });
});

describe('duplicate titles', () => {
  it('warns about a second test with the same title in the same describe', () => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('alerts', () => {
  test('creates an alert', async () => {});
  test('creates an alert', async () => {});
});
for (const symbol of ['AAPL', 'MSFT']) test(\`quotes \${symbol}\`, async () => {});
`);
    expect(inventory.diagnostics.filter((diagnostic) => diagnostic.code === 'duplicate-title')).toMatchObject([
      { lineStart: 4, testId: inventory.tests[1].id, source: 'creates an alert' },
    ]);
  });
});

describe('files Playwright refuses to load', () => {
  it.each([
    ['a test without a body', "test('shows the order preview');"],
    ['a tag without @', "test('validates the symbol', { tag: 'validation' }, async () => {});"],
    ['a chain Playwright does not have', "test.only.skip('places a bracket order', async () => {});"],
    [
      'a title path used twice',
      "test('places a market order', async () => {});\ntest('places a market order', async () => {});",
    ],
  ])('marks every test not loaded for %s, at the line of the problem', (_, problem) => {
    const inventory = scanPlaywright(`${PLAYWRIGHT_IMPORT}
test.describe('orders', { tag: '@orders' }, () => {
  test.skip('places a stop order', async () => {});
  test.fixme(isWebkit, 'confirm dialog stays open');
  test('cancels an order', async () => {});
});
${problem}
`);
    const line = 7 + (problem.includes('\n') ? 1 : 0);
    for (const test of inventory.tests) {
      expect(test).toMatchObject({
        state: 'notLoaded',
        isNotLoaded: true,
        isActive: false,
        isSkipped: false,
        isFixme: false,
        stateSource: 'file',
        stateLine: line,
        isConditional: false,
        condition: null,
        reason: null,
      });
    }
    expect(testNamed(inventory, 'places a stop order')).toMatchObject({ tags: ['@orders'], suitePath: ['orders'] });
    expect(inventory.summary).toMatchObject({ activeCount: 0, skipCount: 0, notLoadedCount: inventory.tests.length });
  });

  it('changes only the tests of the rejected file in a scan', async () => {
    const root = project({
      'package.json': PLAYWRIGHT_PACKAGE,
      'tests/orders.spec.ts': `${PLAYWRIGHT_IMPORT}\ntest('places a market order', async () => {});\ntest.skip('places a stop order', async () => {});\n`,
      'tests/preview.spec.ts': `${PLAYWRIGHT_IMPORT}\ntest('shows the order preview');\ntest('opens the ticket', async () => {});\n`,
    });
    const inventory = await scan({ root, patterns: ['tests/*.spec.ts'], framework: 'playwright' });
    expect(inventory.tests.map((test) => [test.relativeFilePath, test.title, test.state])).toEqual([
      ['tests/orders.spec.ts', 'places a market order', 'active'],
      ['tests/orders.spec.ts', 'places a stop order', 'skip'],
      ['tests/preview.spec.ts', 'opens the ticket', 'notLoaded'],
    ]);
    expect(inventory.summary).toMatchObject({ activeCount: 1, skipCount: 1, notLoadedCount: 1 });
  });

  it('loads a file whose invalid calls are in test, hook or helper bodies, which run after it loads', () => {
    // Playwright 1.49 has neither test.step.skip nor test.abort.
    const inventory = scanPlaywright(
      `${PLAYWRIGHT_IMPORT}
async function signOrder() {
  await test.step.skip('signs the order', async () => {});
}
test.beforeEach(async ({ broker }) => {
  if (!broker.isConnected) test.abort('the broker is down');
});
test('confirms an order in steps', async () => {
  await test.step.skip('fills the ticket', async () => {});
  await signOrder();
});
`,
      { frameworkVersion: '1.49.0' },
    );
    expect(codes(inventory)).toEqual(['invalid-chain', 'invalid-chain', 'invalid-chain']);
    expect(onlyTest(inventory)).toMatchObject({ state: 'active', isNotLoaded: false });
  });
});

describe('files Vitest refuses to load', () => {
  it.each([
    ['a chain Vitest does not have', "test.serial('places a bracket order', () => {});", ['places a bracket order']],
    [
      'sequential, removed in Vitest 5',
      "describe.sequential('stop orders', () => {\n    test('trails the price', () => {});\n  });",
      ['trails the price'],
    ],
    ['options as the third argument', "test('fills a stop order', () => {}, { retry: 3 });", ['fills a stop order']],
    ['a benchmark, removed in Vitest 5', "bench('sizes 1,000 positions', () => {});", []],
  ])('marks every test not loaded for %s, at the line of the problem', (_, problem, refused) => {
    const inventory = scanVitest(`import { bench, describe, test } from 'vitest';
describe('orders', () => {
  test.skip('places a stop order', () => {});
  test('cancels an order', () => {});
  ${problem}
});
`);
    const titles = ['places a stop order', 'cancels an order', ...refused];
    expect(inventory.tests.map((test) => [test.title, test.state, test.stateSource, test.stateLine])).toEqual(
      titles.map((title) => [title, 'notLoaded', 'file', 5]),
    );
    expect(inventory.summary).toMatchObject({ activeCount: 0, skipCount: 0, notLoadedCount: titles.length });
  });

  it('loads a file whose invalid calls are in test, hook or helper bodies, which run after it loads', () => {
    const inventory = scanVitest(`import { beforeEach, test } from 'vitest';
function allowSlowBroker() {
  test.setTimeout(30_000);
}
beforeEach(() => {
  test.slow();
});
test('places a market order', () => {
  allowSlowBroker();
});
`);
    expect(codes(inventory)).toEqual(['invalid-chain', 'invalid-chain']);
    expect(onlyTest(inventory)).toMatchObject({ state: 'active', isNotLoaded: false });
  });
});
