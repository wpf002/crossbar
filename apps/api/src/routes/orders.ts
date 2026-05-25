import type { FastifyInstance } from 'fastify';
import { PlaceOrderSchema } from '@crossbar/shared';
import { cancelOrder, placeOrder, type EngineContext } from '@crossbar/engine';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/errors.js';

interface SerializableOrder {
  id: string;
  marketId: string;
  userId: string;
  side: string;
  outcome: string;
  price: number;
  quantity: number;
  filled: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SerializableTrade {
  id: string;
  marketId: string;
  outcome: string;
  price: number;
  quantity: number;
  buyerUserId: string;
  sellerUserId: string;
  createdAt: Date;
}

function serializeOrder(o: SerializableOrder) {
  return {
    id: o.id,
    marketId: o.marketId,
    userId: o.userId,
    side: o.side,
    outcome: o.outcome,
    price: o.price,
    quantity: o.quantity,
    filled: o.filled,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

function serializeTrade(t: SerializableTrade) {
  return {
    id: t.id,
    marketId: t.marketId,
    outcome: t.outcome,
    price: t.price,
    quantity: t.quantity,
    buyerUserId: t.buyerUserId,
    sellerUserId: t.sellerUserId,
    createdAt: t.createdAt.toISOString(),
  };
}

export default function ordersRoutes(engineCtx: EngineContext) {
  return async function (fastify: FastifyInstance): Promise<void> {
    fastify.addHook('preHandler', fastify.authenticate);

    fastify.post('/', async (req) => {
      const input = PlaceOrderSchema.parse(req.body);

      // TODO(matcher-cutover): once the matcher service is the authoritative
      // book holder, publish the order to Redis channel `orders:incoming`
      // instead of calling the engine directly here. The matcher already
      // subscribes — see apps/matcher/src/index.ts:42.
      const result = await placeOrder(input, req.user.id, engineCtx);

      return {
        order: serializeOrder(result.order),
        fills: result.fills.map(serializeTrade),
      };
    });

    fastify.delete<{ Params: { id: string } }>('/:id', async (req) => {
      const order = await prisma.order.findUnique({ where: { id: req.params.id } });
      if (!order) {
        throw new HttpError(404, 'ORDER_NOT_FOUND', `Order ${req.params.id} not found`);
      }
      if (order.userId !== req.user.id) {
        throw new HttpError(403, 'FORBIDDEN', 'You do not own this order');
      }

      const updated = await cancelOrder(req.params.id, req.user.id, engineCtx);
      return { order: serializeOrder(updated) };
    });
  };
}
