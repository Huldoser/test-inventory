import Fastify from 'fastify';
import type { BrokerClient } from './broker/broker-client.ts';
import { ordersRoutes } from './routes/orders.ts';

export function buildApp(broker: BrokerClient) {
  const app = Fastify({ logger: false });
  app.register(ordersRoutes, { broker });
  return app;
}
