const assert = require('node:assert/strict');
const { Session } = require('../src/session');

describe('FIX session', () => {
  let session;

  beforeEach(() => {
    session = new Session({ senderCompId: 'DESK1', targetCompId: 'XNAS', heartbeat: 30 });
  });

  it('starts at sequence number 1', () => {
    assert.equal(session.send('A', 0).seqNum, 1);
  });

  it('increments the sequence number on each message', () => {
    session.send('A', 0);
    assert.equal(session.send('D', 10).seqNum, 2);
  });

  context('heartbeats', function () {
    this.retries(3);

    it('sends a heartbeat after the interval', () => {
      session.send('A', 0);
      assert.deepEqual(session.due(30_000), { type: '0', testRequestId: null });
    });

    it('answers a test request with a heartbeat', function () {
      this.timeout(250);
      assert.deepEqual(session.due(1000, 'TR-7'), { type: '0', testRequestId: 'TR-7' });
    });
  });

  describe('logon to a live venue', function () {
    before(function () {
      if (!process.env.FIX_HOST) this.skip();
    });

    it('logs on with a sequence reset', () => {
      assert.equal(session.send('A', 0).seqNum, 1);
    });
  });

  it('fills a gap with a sequence reset', function () {
    // FIX-230: gap fill is not built yet
    this.skip();
  });

  describe.skip('drop copy', () => {
    it('mirrors every execution report', () => {});
  });
});
