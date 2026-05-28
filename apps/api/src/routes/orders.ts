import type { FastifyInstance } from 'fastify';
import { PlaceOrderSchema } from '@crossbar/shared';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/errors.js';
import type { MatcherClient } from '../lib/matcher-client.js';

interface SerializedOrder {
  id: string;
  marketId: string;
  userId: string;
  side: string;
  outcome: string;
  price: number;
  quantity: number;
  filled: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface SerializedTrade {
  id: string;
  marketId: string;
  outcome: string;
  price: number;
  quantity: number;
  buyerUserId: string;
  sellerUserId: string;
  createdAt: string;
}

export default function ordersRoutes(matcher: MatcherClient) {
  return async function (fastify: FastifyInstance): Promise<void> {
    fastify.addHook('preHandler', fastify.authenticate);

    fastify.post('/', async (req) => {
      // Validate up front so malformed input fails fast (422) without a round
      // trip to the matcher. The matcher revalidates on its side too.
      const input = PlaceOrderSchema.parse(req.body);

      // The matcher owns the book: hand it the request and block on the reply.
      // Response shape is unchanged — { order, fills } — so clients see no diff.
      return matcher.request<{ order: SerializedOrder; fills: SerializedTrade[] }>(
        'place_order',
        req.user.id,
        input,
      );
    });

    fastify.delete<{ Params: { id: string } }>('/:id', async (req) => {
      // Ownership/existence checks stay in the API so we keep the 404/403
      // contract (the engine collapses both into a 404).
      const order = await prisma.order.findUnique({ where: { id: req.params.id } });
      if (!order) {
        throw new HttpError(404, 'ORDER_NOT_FOUND', `Order ${req.params.id} not found`);
      }
      if (order.userId !== req.user.id) {
        throw new HttpError(403, 'FORBIDDEN', 'You do not own this order');
      }

      return matcher.request<{ order: SerializedOrder }>('cancel_order', req.user.id, {
        orderId: req.params.id,
      });
    });
  };
}
