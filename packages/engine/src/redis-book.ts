import type Redis from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type { OrderBookSnapshot, OrderBookLevel } from '@crossbar/shared';
import { OrderBook, type BookOrder, type OutcomeSide, type Side } from './book.js';

/**
 * Redis key scheme — one sorted set per side per outcome per market.
 * Score: integer price. Member: `{orderId}:{remaining}:{ts}`.
 *
 *   book:{marketId}:{outcome}:bids   ZSET   score = price, member = encoded
 *   book:{marketId}:{outcome}:asks   ZSET   score = price, member = encoded
 */
export const keyFor = (marketId: string, outcome: OutcomeSide, side: Side): string =>
  `book:${marketId}:${outcome}:${side === 'BUY' ? 'bids' : 'asks'}`;

const encodeMember = (orderId: string, remaining: number, ts: number): string =>
  `${orderId}:${remaining}:${ts}`;

const decodeMember = (member: string): { orderId: string; remaining: number; ts: number } => {
  const [orderId, remaining, ts] = member.split(':');
  return {
    orderId: orderId ?? '',
    remaining: Number(remaining),
    ts: Number(ts),
  };
};

/** Add a resting order to Redis under a specific market. */
export async function addToBook(redis: Redis, marketId: string, order: BookOrder): Promise<void> {
  const key = keyFor(marketId, order.outcome, order.side);
  await redis.zadd(key, order.price, encodeMember(order.id, order.remaining, order.ts));
}

/**
 * Remove an order from the Redis book. Scans the candidate sorted set for a
 * member starting with the orderId. We don't know price/outcome/side from
 * just the orderId, so callers should provide them when known; this fallback
 * exists for when they don't (cancellation by id).
 */
export async function removeFromBookByLocation(
  redis: Redis,
  marketId: string,
  outcome: OutcomeSide,
  side: Side,
  orderId: string,
): Promise<void> {
  const key = keyFor(marketId, outcome, side);
  const members = await redis.zrange(key, 0, -1);
  for (const m of members) {
    if (m.startsWith(`${orderId}:`)) {
      await redis.zrem(key, m);
      return;
    }
  }
}

/** Update an order's remaining quantity by removing the old member and re-adding. */
export async function decrementBook(
  redis: Redis,
  marketId: string,
  outcome: OutcomeSide,
  side: Side,
  orderId: string,
  newRemaining: number,
  price: number,
  ts: number,
  oldRemaining: number,
): Promise<void> {
  const key = keyFor(marketId, outcome, side);
  await redis.zrem(key, encodeMember(orderId, oldRemaining, ts));
  if (newRemaining > 0) {
    await redis.zadd(key, price, encodeMember(orderId, newRemaining, ts));
  }
}

export async function snapshotMarket(redis: Redis, marketId: string): Promise<OrderBookSnapshot> {
  const [yesBids, yesAsks, noBids, noAsks] = await Promise.all([
    readSide(redis, marketId, 'YES', 'BUY'),
    readSide(redis, marketId, 'YES', 'SELL'),
    readSide(redis, marketId, 'NO', 'BUY'),
    readSide(redis, marketId, 'NO', 'SELL'),
  ]);

  return {
    marketId,
    yesBids: aggregate(yesBids, 'desc'),
    yesAsks: aggregate(yesAsks, 'asc'),
    noBids: aggregate(noBids, 'desc'),
    noAsks: aggregate(noAsks, 'asc'),
  };
}

async function readSide(
  redis: Redis,
  marketId: string,
  outcome: OutcomeSide,
  side: Side,
): Promise<Array<{ price: number; remaining: number }>> {
  const key = keyFor(marketId, outcome, side);
  const raw = await redis.zrange(key, 0, -1, 'WITHSCORES');
  const out: Array<{ price: number; remaining: number }> = [];
  for (let i = 0; i < raw.length; i += 2) {
    const member = raw[i]!;
    const score = Number(raw[i + 1]!);
    const { remaining } = decodeMember(member);
    out.push({ price: score, remaining });
  }
  return out;
}

function aggregate(
  entries: Array<{ price: number; remaining: number }>,
  direction: 'asc' | 'desc',
): OrderBookLevel[] {
  const map = new Map<number, number>();
  for (const e of entries) {
    map.set(e.price, (map.get(e.price) ?? 0) + e.remaining);
  }
  const levels = [...map.entries()].map(([price, quantity]) => ({ price, quantity }));
  levels.sort((a, b) => (direction === 'asc' ? a.price - b.price : b.price - a.price));
  return levels;
}

/**
 * Rehydrate Redis (and a fresh in-memory book registry) from Postgres for every
 * market with an OPEN status. Called on matcher boot.
 *
 * Returns a map of marketId → in-memory OrderBook so the matcher can use them.
 */
export async function hydrateFromPostgres(
  prisma: PrismaClient,
  redis: Redis,
): Promise<Map<string, OrderBook>> {
  const openMarkets = await prisma.market.findMany({
    where: { status: 'OPEN' },
    select: { id: true },
  });

  const books = new Map<string, OrderBook>();

  for (const { id: marketId } of openMarkets) {
    const book = new OrderBook(marketId);
    books.set(marketId, book);

    // Wipe whatever Redis had — Postgres is the source of truth on boot.
    await Promise.all([
      redis.del(keyFor(marketId, 'YES', 'BUY')),
      redis.del(keyFor(marketId, 'YES', 'SELL')),
      redis.del(keyFor(marketId, 'NO', 'BUY')),
      redis.del(keyFor(marketId, 'NO', 'SELL')),
    ]);

    const orders = await prisma.order.findMany({
      where: {
        marketId,
        status: { in: ['OPEN', 'PARTIAL'] },
        outcome: { in: ['YES', 'NO'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const o of orders) {
      if (o.outcome === 'INVALID') continue;
      const remaining = o.quantity - o.filled;
      if (remaining <= 0) continue;
      const entry: BookOrder = {
        id: o.id,
        userId: o.userId,
        side: o.side,
        outcome: o.outcome,
        price: o.price,
        remaining,
        ts: o.createdAt.getTime(),
      };
      book.addOrder(entry);
      await addToBook(redis, marketId, entry);
    }
  }

  return books;
}

export async function countOpenOrdersPerMarket(prisma: PrismaClient): Promise<Map<string, number>> {
  const rows = await prisma.order.groupBy({
    by: ['marketId'],
    where: { status: { in: ['OPEN', 'PARTIAL'] } },
    _count: { _all: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.marketId, r._count._all);
  return out;
}
