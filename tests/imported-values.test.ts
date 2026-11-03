import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

async function scanFiles(files: Record<string, string>, binary: Record<string, Uint8Array> = {}): Promise<Inventory> {
  const framework = files['package.json'] === VITEST_PACKAGE ? 'vitest' : 'playwright';
  const root = project(files);
  for (const [name, bytes] of Object.entries(binary)) writeFileSync(path.join(root, name), bytes);
  return scan({ root, patterns: ['tests/**/*.{spec,test}.ts'], framework });
}

const messages = (inventory: Inventory) => inventory.diagnostics.map((diagnostic) => diagnostic.message);

describe('values imported from project files', () => {
  it('works out titles, tags, annotations and reasons from constants another file exports', async () => {
    const inventory = await scanFiles({
      'package.json': PLAYWRIGHT_PACKAGE,
      'test-data/accounts.ts': [
        "export const MARGIN_ACCOUNT = { name: 'margin account', currency: 'USD' };",
        "export const TAGS = { risk: '@risk', smoke: '@smoke' } as const;",
        "export const HALTED_REASON = 'The exchange halts trading in the sandbox';",
      ].join('\n'),
      'tests/orders.spec.ts': [
        "import { test } from '@playwright/test';",
        "import { HALTED_REASON, MARGIN_ACCOUNT, TAGS } from '../test-data/accounts';",
        'test(`rejects a short sale on a ${MARGIN_ACCOUNT.name}`, {',
        '  tag: [TAGS.risk, TAGS.smoke],',
        "  annotation: { type: 'currency', description: MARGIN_ACCOUNT.currency },",
        '}, async () => {});',
        'test.skip(`cancels a halted order`, async () => {',
        '  test.skip(true, HALTED_REASON);',
        '});',
        'test.fixme(`settles a halted order`, async () => {});',
        'test.describe(`margin calls`, () => {',
        '  test.skip(true, HALTED_REASON);',
        "  test('liquidates below maintenance', async () => {});",
        '});',
      ].join('\n'),
    });
    const [shortSale, , , liquidates] = inventory.tests;
    expect(shortSale.title).toBe('rejects a short sale on a margin account');
    expect(shortSale.hasDynamicTitle).toBe(false);
    expect(shortSale.tags).toEqual(['@risk', '@smoke']);
    expect(shortSale.annotations).toEqual([expect.objectContaining({ type: 'currency', description: 'USD' })]);
    expect(liquidates.reason).toBe('The exchange halts trading in the sandbox');
    expect(liquidates.hasDynamicReason).toBe(false);
    expect(messages(inventory)).toEqual([]);
  });

  it('counts the cases of a table another file exports, through re-exports and a path alias', async () => {
    const inventory = await scanFiles({
      'package.json': VITEST_PACKAGE,
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/fixtures/*': ['./fixtures/*'] } } }),
      'fixtures/fee-tiers.ts': [
        'export const FEE_TIERS = [',
        "  { tier: 'retail', bps: 25 },",
        "  { tier: 'professional', bps: 10 },",
        "  { tier: 'market maker', bps: 0 },",
        '];',
      ].join('\n'),
      'fixtures/sides.ts': "export enum Side { Buy = 'buy', Sell = 'sell' }",
      'fixtures/index.ts': "export { FEE_TIERS as TIERS } from './fee-tiers';\nexport * from './sides';",
      'tests/fees.test.ts': [
        "import { test } from 'vitest';",
        "import { Side, TIERS } from '@/fixtures/index';",
        "test.each(TIERS)('charges $bps bps to a $tier account', () => {});",
        'test(`fills a ${Side.Sell} order at the bid`, () => {});',
      ].join('\n'),
    });
    expect(inventory.tests.map((test) => [test.title, test.caseCount])).toEqual([
      ['charges $bps bps to a $tier account', 3],
      ['fills a sell order at the bid', null],
    ]);
    expect(messages(inventory)).toEqual([]);
  });

  it('reads default exports, namespace imports and JSON test data', async () => {
    const inventory = await scanFiles({
      'package.json': VITEST_PACKAGE,
      'tests/data/instruments.json': JSON.stringify({ symbols: ['AAPL', 'MSFT'], venue: 'NASDAQ' }),
      'tests/data/limits.ts': [
        'export default { maxNotional: 250000 };',
        "const DESK = 'equities';",
        'export { DESK, DESK as BOOK };',
      ].join('\n'),
      'tests/limits.test.ts': [
        "import { test } from 'vitest';",
        "import instruments, { venue } from './data/instruments.json';",
        "import limits from './data/limits';",
        "import * as risk from './data/limits';",
        'test.for(instruments.symbols)(`quotes %s on ${venue}`, () => {});',
        'test(`caps a ${risk.DESK} order at ${limits.maxNotional}`, () => {});',
        "test(`books to the ${risk['BOOK']} desk`, () => {});",
        'test(`lists ${instruments.symbols.length} symbols on ${venue}`, () => {});',
      ].join('\n'),
    });
    expect(inventory.tests.map((test) => [test.title, test.caseCount])).toEqual([
      ['quotes %s on NASDAQ', 2],
      ['caps a equities order at 250000', null],
      ['books to the equities desk', null],
      ['lists 2 symbols on NASDAQ', null],
    ]);
  });

  it('names the module when an imported value still cannot be worked out', async () => {
    const inventory = await scanFiles(
      {
        'package.json': PLAYWRIGHT_PACKAGE,
        'test-data/session.ts': [
          "export let tradingDay = 'Monday';",
          "export function deskName() { return 'equities'; }",
          'export default function openSession() {}',
          "export { holiday } from './calendar';",
          'export const STATUS = loadStatus();',
          "export { closingBell } from './calendar-rules';",
        ].join('\n'),
        'test-data/calendar-rules.ts': "export const OPENING_BELL = '9:30';",
        'test-data/broken.ts': 'export const = ;',
        'test-data/data.json': '{ not json',
        'test-data/symbols.json': '["AAPL"]',
        'tests/session.spec.ts': [
          "import { test } from '@playwright/test';",
          "import openSession, { deskName, holiday, STATUS, tradingDay, missing } from '../test-data/session';",
          "import { BROKEN } from '../test-data/broken';",
          "import data from '../test-data/data.json';",
          "import { first } from '../test-data/symbols.json';",
          "import logo from '../test-data/logo.png';",
          "import * as session from '../test-data/session';",
          "import { MARKETS } from '@acme/market-data';",
          "import calendar from '../test-data/calendar-rules';",
          "import { closingBell } from '../test-data/session';",
          'test(`opens on ${tradingDay}`, async () => {});',
          'test(`books to ${deskName}`, async () => {});',
          'test(`starts with ${openSession}`, async () => {});',
          'test(`closes on ${holiday}`, async () => {});',
          'test(`reports ${STATUS}`, async () => {});',
          'test(`skips ${missing}`, async () => {});',
          'test(`parses ${BROKEN}`, async () => {});',
          'test(`loads ${data}`, async () => {});',
          'test(`lists ${first}`, async () => {});',
          'test(`shows ${logo}`, async () => {});',
          'test(`prints ${session}`, async () => {});',
          'test(`reads ${session[tradingDay]}`, async () => {});',
          'test(`trades ${MARKETS.us}`, async () => {});',
          'test(`rings at ${closingBell}`, async () => {});',
          'test(`follows ${calendar}`, async () => {});',
        ].join('\n'),
      },
      { 'test-data/logo.png': Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe) },
    );
    expect(inventory.tests.every((test) => test.hasDynamicTitle)).toBe(true);
    const from = inventory.diagnostics
      .filter((diagnostic) => diagnostic.code === 'dynamic-title')
      .map((diagnostic) => /comes from '([^']+)'/.exec(diagnostic.message)?.[1]);
    expect(from).toEqual([
      ...Array<string>(6).fill('../test-data/session'),
      '../test-data/broken',
      '../test-data/data.json',
      '../test-data/symbols.json',
      '../test-data/logo.png',
      '../test-data/session',
      '../test-data/session',
      '@acme/market-data',
      '../test-data/session',
      '../test-data/calendar-rules',
    ]);
  });

  it('finds a name past an export * that leads back, and gives none for a name two export * modules have', async () => {
    const inventory = await scanFiles({
      'package.json': PLAYWRIGHT_PACKAGE,
      'test-data/index.ts': "export * from './accounts';\nexport * from './markets';\nexport * from './crypto';",
      'test-data/accounts.ts': "export * from './index';\nexport const DESK = 'equities';",
      'test-data/markets.ts': "export const MARKET = 'NASDAQ';\nexport const VENUE = 'NYSE';",
      'test-data/crypto.ts': "export const VENUE = 'Coinbase';\nexport { MARKET } from './markets';",
      'tests/routing.spec.ts': [
        "import { test } from '@playwright/test';",
        "import { DESK, MARKET as FROM_INDEX } from '../test-data/index';",
        "import { MARKET as FROM_ACCOUNTS } from '../test-data/accounts';",
        "import { VENUE } from '../test-data/index';",
        'test(`routes a ${DESK} order to ${FROM_INDEX} and ${FROM_ACCOUNTS}`, async () => {});',
        'test(`routes to ${VENUE}`, async () => {});',
      ].join('\n'),
    });
    expect(inventory.tests.map((test) => test.title)).toEqual([
      'routes a equities order to NASDAQ and NASDAQ',
      '`routes to ${VENUE}`',
    ]);
  });

  it('stops following re-exports 16 modules deep', async () => {
    const chain = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `test-data/level-${index}.ts`,
        index === 39 ? "export const DESK = 'equities';" : `export * from './level-${index + 1}';`,
      ]),
    );
    const inventory = await scanFiles({
      'package.json': PLAYWRIGHT_PACKAGE,
      ...chain,
      'test-data/near.ts': "export * from './level-30';",
      'tests/desk.spec.ts': [
        "import { test } from '@playwright/test';",
        "import { DESK } from '../test-data/level-0';",
        "import { DESK as NEAR } from '../test-data/near';",
        'test(`books to ${DESK}`, async () => {});',
        'test(`books near ${NEAR}`, async () => {});',
      ].join('\n'),
    });
    expect(inventory.tests.map((test) => test.title)).toEqual(['`books to ${DESK}`', 'books near equities']);
  });

  it('stops at an import cycle, and still works out the other exports of the module for each file', async () => {
    const inventory = await scanFiles({
      'package.json': PLAYWRIGHT_PACKAGE,
      'test-data/a.ts': "import { B } from './b';\nexport const A = B;\nexport const DESK = 'fx';",
      'test-data/b.ts': "import { A } from './a';\nexport const B = A;",
      'tests/fx/spot.spec.ts': [
        "import { test } from '@playwright/test';",
        "import { A, DESK } from '../../test-data/a';",
        'test(`hedges ${A}`, async () => {});',
        'test(`books a ${DESK} spot trade`, async () => {});',
      ].join('\n'),
      'tests/fx/forward.spec.ts': [
        "import { test } from '@playwright/test';",
        "import { DESK } from '../../test-data/a';",
        'test(`books a ${DESK} forward`, async () => {});',
      ].join('\n'),
    });
    expect(inventory.tests.map((test) => [test.title, test.hasDynamicTitle])).toEqual([
      ['books a fx forward', false],
      ['`hedges ${A}`', true],
      ['books a fx spot trade', false],
    ]);
  });
});
