/**
 * @group integration/custodian
 */
const { settlementDate } = require('../../src/calendar');

jest.retryTimes(2);

const custodian = {
  async send(instruction) {
    return { ...instruction, status: 'accepted', settles: settlementDate(instruction.tradeDate, 1) };
  },
};

describe('settlement instructions', () => {
  test('sends a delivery-versus-payment instruction', async () => {
    const reply = await custodian.send({ type: 'DVP', tradeDate: '2026-11-02' });
    expect(reply).toEqual({ type: 'DVP', tradeDate: '2026-11-02', status: 'accepted', settles: '2026-11-03' });
  }, 30_000);

  test.concurrent.each([['DTC'], ['Euroclear']])('reaches %s', async (depository) => {
    const reply = await custodian.send({ type: 'DVP', depository, tradeDate: '2026-11-02' });
    expect(reply.status).toBe('accepted');
  });

  xit('resends an instruction the custodian lost', async () => {});

  test.skip('amends an instruction before the cut-off', async () => {});
});

describe.each([['equities'], ['bonds']])('%s', (assetClass) => {
  test('settles at T+1', async () => {
    const reply = await custodian.send({ type: 'DVP', assetClass, tradeDate: '2026-11-02' });
    expect(reply.settles).toBe('2026-11-03');
  });
});
