/**
 * @group settlement/unit
 * @group nightly
 */
// Every Jest form the scanner reads, written as one settlement-service suite, with Jest's globals. Not meant to run.
import { CURRENCIES } from './currencies';

jest.retryTimes(2, { waitBeforeRetry: 500 });

describe('trade netting', () => {
  test.each([
    ['AAPL', 100, -40, 60],
    ['MSFT', 50, -50, 0],
  ])('nets %s fills: %d and %d to %d', (symbol, bought, sold, net) => {});

  test.each([1, 5, 10])('rounds a lot of %p shares', (lots) => {});

  it.each([
    { symbol: 'AAPL', venue: { mic: 'XNAS' } },
    { symbol: 'VOD', venue: { mic: 'XLON' } },
  ])('settles $symbol on $venue.mic', ({ symbol, venue }) => {});

  test.each`
    currency | days
    ${'USD'} | ${1}
    ${'EUR'} | ${2}
  `('settles $currency trades in $days days', ({ currency, days }) => {});

  test.each(CURRENCIES)('settles in %s (case %#, number %$)', (currency) => {});
});

describe.each([['equities'], ['options']])('%s settlement', (assetClass) => {
  test('books the cash leg', () => {});
});

describe('settlement instructions', () => {
  beforeEach(() => {});
  afterAll(() => {});

  test('sends the instruction to the custodian', () => {}, 10_000);
  test.concurrent('confirms each fill', async () => {});
  test.concurrent.each([['DTC'], ['Euroclear']])('reaches %s', async (depository) => {});
  test.concurrent.skip('waits for the custodian', async () => {});
  test.failing('rejects an instruction after cut-off', () => {});
  test.concurrent.failing('rejects a duplicate instruction', async () => {});
  test.only.failing.each([[0], [-1]])('rejects a quantity of %i', (quantity) => {});
  test.todo('cancels an instruction');
  xit('resends a lost instruction', () => {});
  xtest('amends an instruction', () => {});
  fit('reconciles with the custodian statement', () => {});
});

xdescribe('fails trades', () => {
  test('marks a trade failed after T+2', () => {});
});

fdescribe('buy-ins', () => {
  test.skip('buys in a failed delivery', () => {});
});

const onlyOnCi = process.env.CI ? test : test.skip;

describe('custodian connection', () => {
  jest.retryTimes(3, { entireDescribe: true });

  onlyOnCi('connects over SFTP', () => {});
});
