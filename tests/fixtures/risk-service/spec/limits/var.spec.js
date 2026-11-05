const { valueAtRisk } = require('../../src/exposure');

describe('value at risk', () => {
  [0.95, 0.99].forEach((confidence) => {
    it(`stays within the desk limit at ${confidence * 100}%`, () => {
      expect(valueAtRisk(10_000_000, 0.012, confidence)).toBeLessThan(300_000);
    });
  });

  xdescribe('stressed', () => {
    it('replays the 2008 shock', () => {});
  });
});
