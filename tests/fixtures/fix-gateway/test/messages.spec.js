const assert = require('node:assert/strict');
const { SOH, checksum, decode, encode } = require('../src/messages');

describe('FIX messages', function () {
  this.timeout(2000);

  it('encodes a new order single', function () {
    const message = encode('D', { 11: 'ORD-1', 55: 'AAPL', 54: '1', 38: '100', 40: '2', 44: '187.50' });
    assert.match(message, /^8=FIX\.4\.4\u00019=\d+\u000135=D\u0001/);
  });

  it('decodes an execution report', function () {
    const fields = decode(encode('8', { 37: 'EX-9', 150: 'F', 31: '187.50', 32: '100' }));
    assert.equal(fields['150'], 'F');
  });

  ['D', 'F', 'G'].forEach((type) => {
    it(`round-trips a message of type ${type}`, function () {
      assert.equal(decode(encode(type, { 11: 'ORD-2' }))['35'], type);
    });
  });

  it('computes the checksum modulo 256', function () {
    assert.equal(checksum(`8=FIX.4.4${SOH}`), '033');
  }).timeout(500);

  // FIX-214: repeating groups are not decoded yet
  it('decodes a repeating group of parties');

  xit('rejects a body length that does not match the body', function () {});
});
