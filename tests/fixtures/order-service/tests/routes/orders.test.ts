import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { BrokerClient } from '../../src/broker/broker-client.ts';

const broker: BrokerClient = {
  submit: vi.fn(async () => ({ brokerOrderId: 'BRK-1001' })),
  cancel: vi.fn(async () => 'canceled' as const),
};

const app = buildApp(broker);

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /orders', () => {
  it('sends a valid limit order to the broker', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 10, limitPrice: 187.5 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ brokerOrderId: 'BRK-1001' });
    expect(broker.submit).toHaveBeenCalledOnce();
  });

  it.each([
    ['a missing symbol', { side: 'buy', type: 'market', quantity: 10 }, 'symbol is required'],
    [
      'a quantity of zero',
      { symbol: 'AAPL', side: 'buy', type: 'market', quantity: 0 },
      'quantity must be a positive whole number',
    ],
    [
      'a limit order without a price',
      { symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 10 },
      'limitPrice is required for limit orders',
    ],
  ])('rejects %s with 400', async (_, payload, error) => {
    const response = await app.inject({ method: 'POST', url: '/orders', payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(broker.submit).not.toHaveBeenCalled();
  });

  it('answers 502 when the broker is down', async () => {
    vi.mocked(broker.submit).mockRejectedValueOnce(new Error('ECONNRESET'));
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { symbol: 'MSFT', side: 'sell', type: 'market', quantity: 5 },
    });
    expect(response.statusCode).toBe(502);
  });

  it.todo('cancels the order at the broker when the client disconnects');
});

describe('DELETE /orders/:id', () => {
  it('cancels a working order', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/orders/BRK-1001' });
    expect(response.statusCode).toBe(204);
    expect(broker.cancel).toHaveBeenCalledWith('BRK-1001');
  });

  it('answers 409 for an order that is already filled', async () => {
    vi.mocked(broker.cancel).mockResolvedValueOnce('already-filled');
    const response = await app.inject({ method: 'DELETE', url: '/orders/BRK-1002' });
    expect(response.statusCode).toBe(409);
  });
});
