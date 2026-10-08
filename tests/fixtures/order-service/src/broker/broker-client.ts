export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  limitPrice?: number;
}

export interface BrokerClient {
  submit(order: OrderRequest): Promise<{ brokerOrderId: string }>;
  cancel(brokerOrderId: string): Promise<'canceled' | 'already-filled'>;
}
