import { priceOf, type Order } from './order.ts';

export interface Account {
  buyingPower: number;
  /** Shares held per symbol. */
  positions: Record<string, number>;
  canShortSell: boolean;
}

export type OrderError =
  | 'quantity must be a positive whole number'
  | 'price must be positive'
  | 'insufficient buying power'
  | 'insufficient shares to sell';

export function validateOrder(order: Order, account: Account, lastPrice: number): OrderError | null {
  if (!Number.isInteger(order.quantity) || order.quantity <= 0) return 'quantity must be a positive whole number';
  const price = priceOf(order);
  if (price !== null && price <= 0) return 'price must be positive';
  if (order.side === 'buy' && order.quantity * (price ?? lastPrice) > account.buyingPower) {
    return 'insufficient buying power';
  }
  if (order.side === 'sell' && !account.canShortSell && order.quantity > (account.positions[order.symbol] ?? 0)) {
    return 'insufficient shares to sell';
  }
  return null;
}
