/** Why an order can't be routed for a client, or null when it can. */
export function routingBlock({ quantity, buyingPower, price }) {
  if (!Number.isInteger(quantity) || quantity < 1) return 'Quantity must be at least 1';
  if (quantity * price > buyingPower) return 'The order is above the buying power';
  return null;
}
