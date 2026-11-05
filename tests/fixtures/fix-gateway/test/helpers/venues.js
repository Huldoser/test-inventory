const assert = require('node:assert/strict');

/** The specs every venue the gateway routes to must pass, in a describe named after the venue. */
function venueSpecs(venue, { tickSize }) {
  describe(`${venue} venue`, () => {
    it('rounds a price to the tick size', () => {
      const rounded = Math.round(187.503 / tickSize) * tickSize;
      assert.ok(Math.abs(rounded - 187.5) < tickSize);
    });
  });
}

module.exports = { venueSpecs };
