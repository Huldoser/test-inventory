import type { FastifyPluginAsync } from 'fastify';
import type { BrokerClient, OrderRequest } from '../broker/broker-client.ts';

function validate(order: Partial<OrderRequest>): string | null {
  if (!order.symbol) return 'symbol is required';
  if (!Number.isInteger(order.quantity) || (order.quantity ?? 0) <= 0) {
    return 'quantity must be a positive whole number';
  }
  if (order.type === 'limit' && order.limitPrice === undefined) return 'limitPrice is required for limit orders';
  return null;
}

export const ordersRoutes: FastifyPluginAsync<{ broker: BrokerClient }> = async (app, { broker }) => {
  app.post<{ Body: Partial<OrderRequest> }>('/orders', async (request, reply) => {
    const error = validate(request.body);
    if (error) return reply.code(400).send({ error });
    try {
      const { brokerOrderId } = await broker.submit(request.body as OrderRequest);
      return reply.code(201).send({ brokerOrderId });
    } catch {
      return reply.code(502).send({ error: 'broker unavailable' });
    }
  });

  app.delete<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    const result = await broker.cancel(request.params.id);
    if (result === 'already-filled') return reply.code(409).send({ error: 'order is already filled' });
    return reply.code(204).send();
  });
};
