import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/errors.js';

const PaginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const OrderStatusEnum = z.enum(['OPEN', 'PARTIAL', 'FILLED', 'CANCELED']);

const OrdersQuerySchema = PaginationSchema.extend({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((v) => v.trim()) : undefined))
    .pipe(z.array(OrderStatusEnum).optional()),
});

function serializeOrder(o: {
  id: string;
  marketId: string;
  userId: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO' | 'INVALID';
  price: number;
  quantity: number;
  filled: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
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

function serializeTrade(t: {
  id: string;
  marketId: string;
  outcome: string;
  price: number;
  quantity: number;
  buyerUserId: string;
  sellerUserId: string;
  createdAt: Date;
}) {
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

export default async function meRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, username: true, createdAt: true },
    });
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'User not found');
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      createdAt: user.createdAt.toISOString(),
    };
  });

  fastify.get('/wallet', async (req) => {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
    if (!wallet) throw new HttpError(404, 'NOT_FOUND', 'Wallet not found');
    // Engine accounting: `balance` is already free funds (reserved is moved
     // out on order placement and back in on cancel/refund). So `available`
     // equals `balance` — the literal `balance - reserved` would double-count.
    return {
      balance: wallet.balance,
      reserved: wallet.reserved,
      available: wallet.balance,
    };
  });

  fastify.get('/positions', async (req) => {
    const positions = await prisma.position.findMany({
      where: { userId: req.user.id },
      include: {
        market: {
          select: {
            id: true,
            question: true,
            type: true,
            status: true,
            eventId: true,
          },
        },
      },
    });

    const marketIds = positions.map((p) => p.marketId);
    const lastTrades = await lastTradePerMarket(marketIds);

    return positions.map((p) => ({
      marketId: p.marketId,
      yesShares: p.yesShares,
      noShares: p.noShares,
      avgYesCost: p.avgYesCost,
      avgNoCost: p.avgNoCost,
      realizedPnl: p.realizedPnl,
      lastTradePrice: lastTrades.get(p.marketId) ?? null,
      market: {
        id: p.market.id,
        question: p.market.question,
        type: p.market.type,
        status: p.market.status,
      },
    }));
  });

  fastify.get<{ Params: { marketId: string } }>('/positions/:marketId', async (req) => {
    const position = await prisma.position.findUnique({
      where: { userId_marketId: { userId: req.user.id, marketId: req.params.marketId } },
    });
    if (!position) {
      throw new HttpError(404, 'NOT_FOUND', 'No position in that market');
    }
    const lastTrade = await prisma.trade.findFirst({
      where: { marketId: req.params.marketId },
      orderBy: { createdAt: 'desc' },
      select: { price: true },
    });
    return {
      marketId: position.marketId,
      yesShares: position.yesShares,
      noShares: position.noShares,
      avgYesCost: position.avgYesCost,
      avgNoCost: position.avgNoCost,
      realizedPnl: position.realizedPnl,
      lastTradePrice: lastTrade?.price ?? null,
    };
  });

  fastify.get('/trades', async (req) => {
    const { limit, offset } = PaginationSchema.parse(req.query);
    const trades = await prisma.trade.findMany({
      where: { OR: [{ buyerUserId: req.user.id }, { sellerUserId: req.user.id }] },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return { trades: trades.map(serializeTrade), limit, offset };
  });

  fastify.get('/orders', async (req) => {
    const { limit, offset, status } = OrdersQuerySchema.parse(req.query);
    const orders = await prisma.order.findMany({
      where: {
        userId: req.user.id,
        ...(status && status.length > 0 ? { status: { in: status } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return { orders: orders.map(serializeOrder), limit, offset };
  });
}

async function lastTradePerMarket(marketIds: string[]): Promise<Map<string, number>> {
  if (marketIds.length === 0) return new Map();
  const rows = await prisma.trade.findMany({
    where: { marketId: { in: marketIds } },
    orderBy: { createdAt: 'desc' },
    select: { marketId: true, price: true, createdAt: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!out.has(r.marketId)) out.set(r.marketId, r.price);
  }
  return out;
}
