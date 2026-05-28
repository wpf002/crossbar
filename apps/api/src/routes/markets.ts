import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import { z } from 'zod';
import type { OrderBookSnapshot } from '@crossbar/shared';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/errors.js';
import { bookSnapshotKey } from '../lib/events.js';

const ListMarketsQuery = z.object({
  sport: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((v) => v.trim().toLowerCase()) : undefined)),
  type: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((v) => v.trim().toUpperCase()) : undefined))
    .pipe(z.array(z.enum(['MONEYLINE', 'TOTAL', 'SPREAD'])).optional()),
});

const PaginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const TOP_OF_BOOK_LEVELS = 20;

function emptySnapshot(marketId: string): OrderBookSnapshot {
  return { marketId, yesBids: [], yesAsks: [], noBids: [], noAsks: [] };
}

/** Read a single market's book snapshot from Redis (matcher-maintained). */
async function readSnapshot(redis: Redis | null, marketId: string): Promise<OrderBookSnapshot> {
  if (!redis) return emptySnapshot(marketId);
  const raw = await redis.get(bookSnapshotKey(marketId));
  if (!raw) return emptySnapshot(marketId);
  try {
    return JSON.parse(raw) as OrderBookSnapshot;
  } catch {
    return emptySnapshot(marketId);
  }
}

/** Read many snapshots in one round trip via MGET. */
async function readSnapshots(
  redis: Redis | null,
  marketIds: string[],
): Promise<Map<string, OrderBookSnapshot>> {
  const out = new Map<string, OrderBookSnapshot>();
  if (!redis || marketIds.length === 0) {
    for (const id of marketIds) out.set(id, emptySnapshot(id));
    return out;
  }
  const raws = await redis.mget(marketIds.map(bookSnapshotKey));
  marketIds.forEach((id, i) => {
    const raw = raws[i];
    if (raw) {
      try {
        out.set(id, JSON.parse(raw) as OrderBookSnapshot);
        return;
      } catch {
        /* fall through to empty */
      }
    }
    out.set(id, emptySnapshot(id));
  });
  return out;
}

function topOfBook(snap: OrderBookSnapshot) {
  return {
    yesBid: snap.yesBids[0]?.price ?? null,
    yesAsk: snap.yesAsks[0]?.price ?? null,
    noBid: snap.noBids[0]?.price ?? null,
    noAsk: snap.noAsks[0]?.price ?? null,
  };
}

function depthAt(snap: OrderBookSnapshot) {
  return {
    yesBidQty: snap.yesBids[0]?.quantity ?? 0,
    yesAskQty: snap.yesAsks[0]?.quantity ?? 0,
    noBidQty: snap.noBids[0]?.quantity ?? 0,
    noAskQty: snap.noAsks[0]?.quantity ?? 0,
  };
}

function truncateLevels(snap: OrderBookSnapshot, limit: number): OrderBookSnapshot {
  return {
    marketId: snap.marketId,
    yesBids: snap.yesBids.slice(0, limit),
    yesAsks: snap.yesAsks.slice(0, limit),
    noBids: snap.noBids.slice(0, limit),
    noAsks: snap.noAsks.slice(0, limit),
    lastTradePrice: snap.lastTradePrice,
    lastTradeAt: snap.lastTradeAt,
  };
}

export default function marketsRoutes(redis: Redis | null) {
  return async function (fastify: FastifyInstance): Promise<void> {
    fastify.get('/', async (req) => {
      const { sport, type } = ListMarketsQuery.parse(req.query);
      const markets = await prisma.market.findMany({
        where: {
          status: 'OPEN',
          ...(type && type.length > 0 ? { type: { in: type } } : {}),
          ...(sport && sport.length > 0 ? { event: { sportId: { in: sport } } } : {}),
        },
        include: {
          event: {
            select: {
              id: true,
              sportId: true,
              homeTeam: true,
              awayTeam: true,
              startsAt: true,
              status: true,
            },
          },
        },
        orderBy: { event: { startsAt: 'asc' } },
      });

      const ids = markets.map((m) => m.id);
      const [lastTrades, volumes24h, traderCounts, snapshots] = await Promise.all([
        lastTradePerMarket(ids),
        volume24hPerMarket(ids),
        traderCountPerMarket(ids),
        readSnapshots(redis, ids),
      ]);

      return markets.map((m) => {
        const snap = snapshots.get(m.id) ?? emptySnapshot(m.id);
        return {
          id: m.id,
          type: m.type,
          question: m.question,
          yesLabel: m.yesLabel,
          noLabel: m.noLabel,
          line: m.line,
          status: m.status,
          event: {
            id: m.event.id,
            sportId: m.event.sportId,
            homeTeam: m.event.homeTeam,
            awayTeam: m.event.awayTeam,
            startsAt: m.event.startsAt.toISOString(),
            status: m.event.status,
          },
          topOfBook: topOfBook(snap),
          depth: depthAt(snap),
          lastTradePrice: lastTrades.get(m.id) ?? null,
          volume24h: volumes24h.get(m.id) ?? 0,
          traders: traderCounts.get(m.id) ?? 0,
        };
      });
    });

    fastify.get<{ Params: { id: string }; Querystring: { bucket?: string; hours?: string } }>(
      '/:id/candles',
      async (req) => {
        const exists = await prisma.market.findUnique({
          where: { id: req.params.id },
          select: { id: true },
        });
        if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Market not found');

        const bucketMs = Math.max(60_000, Number(req.query.bucket ?? 300_000));
        const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 24)));
        const since = new Date(Date.now() - hours * 3600_000);

        const trades = await prisma.trade.findMany({
          where: { marketId: req.params.id, outcome: 'YES', createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
          select: { price: true, quantity: true, createdAt: true },
        });

        const candles = bucketTrades(trades, bucketMs, since);
        return { marketId: req.params.id, bucketMs, hours, candles };
      },
    );

    fastify.get<{ Params: { id: string } }>('/:id', async (req) => {
      const m = await prisma.market.findUnique({
        where: { id: req.params.id },
        include: {
          event: {
            select: {
              id: true,
              sportId: true,
              homeTeam: true,
              awayTeam: true,
              startsAt: true,
              status: true,
            },
          },
        },
      });
      if (!m) throw new HttpError(404, 'NOT_FOUND', 'Market not found');

      const [lastTrade, snap] = await Promise.all([
        prisma.trade.findFirst({
          where: { marketId: m.id },
          orderBy: { createdAt: 'desc' },
          select: { price: true, createdAt: true },
        }),
        readSnapshot(redis, m.id),
      ]);

      return {
        id: m.id,
        type: m.type,
        question: m.question,
        yesLabel: m.yesLabel,
        noLabel: m.noLabel,
        line: m.line,
        status: m.status,
        outcome: m.outcome,
        closedAt: m.closedAt?.toISOString() ?? null,
        resolvedAt: m.resolvedAt?.toISOString() ?? null,
        event: {
          id: m.event.id,
          sportId: m.event.sportId,
          homeTeam: m.event.homeTeam,
          awayTeam: m.event.awayTeam,
          startsAt: m.event.startsAt.toISOString(),
          status: m.event.status,
        },
        topOfBook: topOfBook(snap),
        lastTrade: lastTrade
          ? { price: lastTrade.price, at: lastTrade.createdAt.toISOString() }
          : null,
      };
    });

    fastify.get<{ Params: { id: string } }>('/:id/book', async (req) => {
      const exists = await prisma.market.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Market not found');

      const snapshot = await readSnapshot(redis, req.params.id);
      return truncateLevels(snapshot, TOP_OF_BOOK_LEVELS);
    });

    fastify.get<{ Params: { id: string } }>('/:id/trades', async (req) => {
      const { limit, offset } = PaginationSchema.parse(req.query);
      const exists = await prisma.market.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Market not found');

      const trades = await prisma.trade.findMany({
        where: { marketId: req.params.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });
      return {
        trades: trades.map((t) => ({
          id: t.id,
          marketId: t.marketId,
          outcome: t.outcome,
          price: t.price,
          quantity: t.quantity,
          buyerUserId: t.buyerUserId,
          sellerUserId: t.sellerUserId,
          createdAt: t.createdAt.toISOString(),
        })),
        limit,
        offset,
      };
    });
  };
}

async function lastTradePerMarket(marketIds: string[]): Promise<Map<string, number>> {
  if (marketIds.length === 0) return new Map();
  const rows = await prisma.trade.findMany({
    where: { marketId: { in: marketIds } },
    orderBy: { createdAt: 'desc' },
    select: { marketId: true, price: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!out.has(r.marketId)) out.set(r.marketId, r.price);
  }
  return out;
}

/** Sum of `price * quantity` over the last 24h, per market (cents). */
async function volume24hPerMarket(marketIds: string[]): Promise<Map<string, number>> {
  if (marketIds.length === 0) return new Map();
  const since = new Date(Date.now() - 24 * 3600_000);
  const rows = await prisma.trade.findMany({
    where: { marketId: { in: marketIds }, createdAt: { gte: since } },
    select: { marketId: true, price: true, quantity: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.marketId, (out.get(r.marketId) ?? 0) + r.price * r.quantity);
  }
  return out;
}

/** Distinct trader count per market (buyer or seller, all time). */
async function traderCountPerMarket(marketIds: string[]): Promise<Map<string, number>> {
  if (marketIds.length === 0) return new Map();
  const rows = await prisma.trade.findMany({
    where: { marketId: { in: marketIds } },
    select: { marketId: true, buyerUserId: true, sellerUserId: true },
  });
  const sets = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = sets.get(r.marketId);
    if (!s) {
      s = new Set();
      sets.set(r.marketId, s);
    }
    s.add(r.buyerUserId);
    s.add(r.sellerUserId);
  }
  const out = new Map<string, number>();
  for (const [k, v] of sets) out.set(k, v.size);
  return out;
}

interface Candle {
  t: number; // bucket start (ms)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // volume in shares
}

/** Bucket YES trades into OHLCV candles. Empty buckets carry forward the close. */
function bucketTrades(
  trades: Array<{ price: number; quantity: number; createdAt: Date }>,
  bucketMs: number,
  since: Date,
): Candle[] {
  if (trades.length === 0) return [];

  const startMs = Math.floor(since.getTime() / bucketMs) * bucketMs;
  const endMs = Math.floor(Date.now() / bucketMs) * bucketMs;
  const buckets = new Map<number, Candle>();

  for (const t of trades) {
    const bucket = Math.floor(t.createdAt.getTime() / bucketMs) * bucketMs;
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, {
        t: bucket,
        o: t.price,
        h: t.price,
        l: t.price,
        c: t.price,
        v: t.quantity,
      });
    } else {
      existing.h = Math.max(existing.h, t.price);
      existing.l = Math.min(existing.l, t.price);
      existing.c = t.price;
      existing.v += t.quantity;
    }
  }

  // Fill gaps with synthetic candles using the previous close.
  const out: Candle[] = [];
  let lastClose: number | null = null;
  for (let t = startMs; t <= endMs; t += bucketMs) {
    const c = buckets.get(t);
    if (c) {
      out.push(c);
      lastClose = c.c;
    } else if (lastClose != null) {
      out.push({ t, o: lastClose, h: lastClose, l: lastClose, c: lastClose, v: 0 });
    }
  }
  return out;
}
