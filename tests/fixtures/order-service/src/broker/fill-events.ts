export type OrderStatus = 'working' | 'partially-filled' | 'filled' | 'canceled' | 'rejected';

export interface FillEvent {
  event: 'new' | 'partial_fill' | 'fill' | 'canceled' | 'rejected';
  orderId: string;
  filledQuantity: number;
}

const STATUSES: Record<FillEvent['event'], OrderStatus> = {
  new: 'working',
  partial_fill: 'partially-filled',
  fill: 'filled',
  canceled: 'canceled',
  rejected: 'rejected',
};

export function toOrderStatus(fill: FillEvent): OrderStatus {
  return STATUSES[fill.event];
}

export function filledShares(fill: FillEvent): number {
  return Math.floor(fill.filledQuantity);
}
