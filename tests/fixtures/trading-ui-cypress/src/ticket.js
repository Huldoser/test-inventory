/** The notional of an order: quantity times limit price, in cents to avoid float drift. */
function notional({ quantity, limit }) {
  return Math.round(quantity * limit * 100) / 100;
}

/** Why an order ticket can't be sent, or null when it can. */
function rejection({ quantity, limit }) {
  if (!Number.isInteger(quantity) || quantity < 1) return 'Quantity must be at least 1';
  if (quantity > 1_000_000) return 'Quantity is above the 1,000,000 share limit';
  if (limit !== undefined && limit <= 0) return 'Limit must be above 0';
  return null;
}

module.exports = { notional, rejection };
