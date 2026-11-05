/** Gross exposure: the sum of every position's absolute market value. */
function grossExposure(positions) {
  return positions.reduce((sum, position) => sum + Math.abs(position.quantity * position.price), 0);
}

/** Net exposure: longs less shorts. */
function netExposure(positions) {
  return positions.reduce((sum, position) => sum + position.quantity * position.price, 0);
}

/** One-day value at risk at a confidence level, from the portfolio's value and daily volatility. */
function valueAtRisk(value, volatility, confidence) {
  const z = { 0.95: 1.645, 0.99: 2.326 }[confidence];
  return Math.round(value * volatility * z);
}

module.exports = { grossExposure, netExposure, valueAtRisk };
