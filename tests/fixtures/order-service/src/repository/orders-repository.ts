import type { OrderRequest } from '../broker/broker-client.ts';
import type { Database } from './database.ts';

export interface StoredOrder extends OrderRequest {
  id: number;
  accountId: string;
  brokerOrderId: string;
  status: string;
  createdAt: Date;
}

export class OrdersRepository {
  constructor(private readonly sql: Database) {}

  async insert(accountId: string, order: OrderRequest, brokerOrderId: string): Promise<StoredOrder> {
    const [row] = await this.sql<StoredOrder[]>`
      insert into orders ${this.sql({ ...order, accountId, brokerOrderId, status: 'working' })}
      returning *`;
    return row;
  }

  async working(accountId: string): Promise<StoredOrder[]> {
    return this.sql<StoredOrder[]>`
      select * from orders where account_id = ${accountId} and status = 'working' order by created_at desc`;
  }
}
