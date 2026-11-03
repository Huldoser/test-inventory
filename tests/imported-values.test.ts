import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { PLAYWRIGHT_PACKAGE, project, VITEST_PACKAGE } from './project.ts';

async function scanFiles(files: Record<string, string>): Promise<Inventory> {
  const framework = 'package.json' in files && files['package.json'] === VITEST_PACKAGE ? 'vitest' : 'playwright';
  return scan({ root: project(files), patterns: ['tests/**/*.{spec,test}.ts'], framework });
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
      'tests/data/limits.ts': "export default { maxNotional: 250000 };\nexport const DESK = 'equities';",
      'tests/limits.test.ts': [
        "import { test } from 'vitest';",
        "import instruments, { venue } from './data/instruments.json';",
        "import limits from './data/limits';",
        "import * as risk from './data/limits';",
        'test.for(instruments.symbols)(`quotes %s on ${venue}`, () => {});',
        'test(`caps a ${risk.DESK} order at ${limits.maxNotional}`, () => {});',
        "test(`books to the ${risk['DESK']} desk`, () => {});",
      ].join('\n'),
    });
    expect(inventory.tests.map((test) => [test.title, test.caseCount])).toEqual([
      ['quotes %s on NASDAQ', 2],
      ['caps a equities order at 250000', null],
      ['books to the equities desk', null],
    ]);
  });

  it('names the module when an imported value still cannot be worked out', async () => {
    const inventory = await scanFiles({
      'package.json': PLAYWRIGHT_PACKAGE,
      'test-data/session.ts': [
        "export let tradingDay = 'Monday';",
        "export function deskName() { return 'equities'; }",
        "export default function openSession() {}",
        "export { holiday } from './calendar';",
        "export const STATUS = loadStatus();",
      ].join('\n'),
      'test-data/broken.ts': 'export const = ;',
      'test-data/data.json': '{ not json',
      'test-data/symbols.json': '["AAPL"]',
      'test-data/logo.png': '\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDRÿþ',
      'tests/session.spec.ts': [
        "import { test } from '@playwright/test';",
        "import openSession, { deskName, holiday, STATUS, tradingDay, missing } from '../test-data/session';",
        "import { BROKEN } from '../test-data/broken';",
        "import data from '../test-data/data.json';",
        "import { first } from '../test-data/symbols.json';",
        "import logo from '../test-data/logo.png';",
        "import * as session from '../test-data/session';",
        "import { MARKETS } from '@acme/market-data';",
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
      ].join('\n'),
    });
    expect(inventory.tests.every((test) => test.hasDynamicTitle)).toBe(true);
    const from = inventory.diagnostics
      .filter((diagnostic) => diagnostic.code === 'dynamic-title')
      .map((diagnostic) => /comes from '([^']+)'/.exec(diagnostic.message)?.[1]);
    expect(from).toEqual([
      ...Array(6).fill('../test-data/session'),
      '../test-data/broken',
      '../test-data/data.json',
      '../test-data/symbols.json',
      '../test-data/logo.png',
      '../test-data/session',
      '../test-data/session',
      '@acme/market-data',
    ]);
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
