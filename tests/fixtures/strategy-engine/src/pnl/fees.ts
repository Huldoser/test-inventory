/** Commission per share with a minimum per order, plus the regulatory fee on sales. */
export function commission(quantity: number, perShare = 0.005, minimum = 1): number {
  return Math.max(quantity * perShare, minimum);
}

/** SEC fee on the value of a sale, $27.80 per million, rounded to the cent. */
export function secFee(saleValue: number): number {
  return Math.round(saleValue * 0.0000278 * 100) / 100;
}

export function totalFees(side: 'buy' | 'sell', quantity: number, price: number): number {
  return commission(quantity) + (side === 'sell' ? secFee(quantity * price) : 0);
}
