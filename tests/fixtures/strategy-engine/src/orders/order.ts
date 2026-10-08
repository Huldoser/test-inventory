interface BaseOrder {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
}

export interface MarketOrder extends BaseOrder {
  type: 'market';
}

export interface LimitOrder extends BaseOrder {
  type: 'limit';
  limitPrice: number;
}

export interface StopOrder extends BaseOrder {
  type: 'stop';
  stopPrice: number;
}

export type Order = MarketOrder | LimitOrder | StopOrder;

export type OrderStatus = 'working' | 'partially-filled' | 'filled' | 'cancelled' | 'rejected';

export function priceOf(order: Order): number | null {
  switch (order.type) {
    case 'market':
      return null;
    case 'limit':
      return order.limitPrice;
    case 'stop':
      return order.stopPrice;
  }
}
