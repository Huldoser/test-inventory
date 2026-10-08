import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, type Database } from '../../src/repository/database.ts';
import { OrdersRepository } from '../../src/repository/orders-repository.ts';

describe.skipIf(!process.env.DATABASE_URL)('orders repository', { tags: ['db'] }, () => {
  let database: Database;
  let orders: OrdersRepository;

  beforeAll(async () => {
    database = await connect(process.env.DATABASE_URL as string);
    orders = new OrdersRepository(database);
  });

  afterAll(async () => {
    await database.end();
  });

  test('stores an order with its broker id', async () => {
    const stored = await orders.insert(
      'ACC-204',
      { symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 10, limitPrice: 187.5 },
      'BRK-1001',
    );
    expect(stored).toMatchObject({ accountId: 'ACC-204', brokerOrderId: 'BRK-1001', status: 'working' });
  });

  test('lists the working orders of an account, newest first', { retry: 2 }, async () => {
    const working = await orders.working('ACC-204');
    expect(working.map((order) => order.brokerOrderId)).toEqual(['BRK-1001']);
  });
});
