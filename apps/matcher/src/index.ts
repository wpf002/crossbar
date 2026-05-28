import pino from 'pino';
import Redis from 'ioredis';
import { prisma } from '@crossbar/db';
import type { Order, Trade } from '@crossbar/db';
import {
  EngineError,
  OrderNotFoundError,
  cancelOrder,
  closeMarket,
  createMarket,
  hydrateFromPostgres,
  keyFor,
  OrderBook,
  placeOrder,
  resolveMarket,
  voidMarket,
  type EngineContext,
} from '@crossbar/engine';
import { createEventBus, type EventBus } from './events.js';
import {
  publishCancelEffects,
  publishLifecycleEffects,
  publishOrderEffects,
} from './publish-effects.js';

export const STREAM = 'orders:incoming';
export const GROUP = 'matcher-workers';

export type MatcherAction =
  | 'place_order'
  | 'cancel_order'
  | 'close_market'
  | 'resolve_market'
  | 'void_market'
  | 'create_market';

interface RequestEntry {
  requestId: string;
  action: MatcherAction;
  userId: string;
  payload: unknown;
}

interface ReplyOk {
  status: 'ok';
  data: unknown;
}
interface ReplyErr {
  status: 'error';
  error: { code: string; message: string; status: number };
}

export interface RunMatcherOptions {
  redisUrl?: string;
  /** Unique consumer name within the group; defaults to consumer-<pid>. */
  consumerName?: string;
  /**
   * Delete the stream (and its groups) before booting so the consumer starts
   * from a clean slate. Test-only — guards against leftover messages from a
   * prior run referencing markets that have since been truncated.
   */
  resetStream?: boolean;
  /** Suppress all logging (test harness). */
  silent?: boolean;
  log?: pino.Logger;
}

export interface MatcherHandle {
  /** Stop the consumer loop and release all connections. */
  stop(): Promise<void>;
  /** Test seam — process a single raw request entry without the stream. */
  handle(entry: RequestEntry): Promise<void>;
}

const defaultLog = pino({
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

/**
 * Boot the matcher: hydrate books from Postgres, create the consumer group,
 * and run the XREADGROUP loop until `stop()` is called.
 *
 * This is the production entrypoint AND the test seam — integration tests boot
 * a matcher in-process against the same Redis/Postgres the API uses.
 */
export async function runMatcher(opts: RunMatcherOptions = {}): Promise<MatcherHandle> {
  const log = opts.log ?? (opts.silent ? pino({ level: 'silent' }) : defaultLog);
  const redisUrl = opts.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

  // One connection for ordinary commands, one dedicated to the blocking read.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const reader = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const bus = createEventBus(redisUrl);

  log.info('crossbar matcher booting');
  const books = await hydrateFromPostgres(prisma, redis);
  for (const marketId of books.keys()) log.info({ marketId }, 'hydrated market');

  const ctx: EngineContext = { prisma, redis, books };

  if (opts.resetStream) {
    await redis.del(STREAM);
  }

  // Create the consumer group, tolerating an existing one (BUSYGROUP).
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
  } catch (err) {
    if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err;
  }

  const consumer = opts.consumerName ?? `consumer-${process.pid}`;
  let running = true;

  const loop = (async () => {
    while (running) {
      let res: Array<[string, Array<[string, string[]]>]> | null;
      try {
        res = (await reader.xreadgroup(
          'GROUP',
          GROUP,
          consumer,
          'COUNT',
          10,
          'BLOCK',
          5000,
          'STREAMS',
          STREAM,
          '>',
        )) as Array<[string, Array<[string, string[]]>]> | null;
      } catch (err) {
        if (!running) break;
        log.error({ err }, 'xreadgroup failed');
        continue;
      }
      if (!res) continue;

      for (const [, entries] of res) {
        for (const [messageId, fields] of entries) {
          try {
            const entry = parseFields(fields);
            if (entry) await handleRequest(entry, ctx, bus, redis, log);
          } catch (err) {
            log.error({ err, messageId }, 'unhandled error processing message');
          } finally {
            // Always ACK — a broken message must not redeliver forever. Crash
            // recovery is covered by the idempotency key, not by replay.
            await redis.xack(STREAM, GROUP, messageId).catch(() => undefined);
          }
        }
      }
    }
  })();

  log.info({ consumer }, `listening on Redis stream ${STREAM}`);

  return {
    async stop() {
      running = false;
      reader.disconnect(); // unblock an in-flight XREADGROUP
      await loop.catch(() => undefined);
      await reader.quit().catch(() => undefined);
      await redis.quit().catch(() => undefined);
      await bus.close();
    },
    async handle(entry: RequestEntry) {
      await handleRequest(entry, ctx, bus, redis, log);
    },
  };
}

function parseFields(fields: string[]): RequestEntry | null {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    map[fields[i]!] = fields[i + 1]!;
  }
  if (!map.requestId || !map.action) return null;
  let payload: unknown = {};
  try {
    payload = map.payload ? JSON.parse(map.payload) : {};
  } catch {
    payload = {};
  }
  return {
    requestId: map.requestId,
    action: map.action as MatcherAction,
    userId: map.userId ?? 'system',
    payload,
  };
}

async function handleRequest(
  entry: RequestEntry,
  ctx: EngineContext,
  bus: EventBus,
  redis: Redis,
  log: pino.Logger,
): Promise<void> {
  const replyKey = `orders:result:${entry.requestId}`;

  // Idempotency: the FIRST time we see a requestId we claim it. A failed claim
  // means this is a redelivery (matcher restarted between handle and ACK) — the
  // work already happened, so we must not run it again (double-settle).
  const claimed = await redis.set(`orders:dedup:${entry.requestId}`, '1', 'EX', 86400, 'NX');
  if (claimed === null) {
    log.info({ requestId: entry.requestId, action: entry.action }, 'duplicate request — skipped');
    return;
  }

  try {
    const data = await dispatch(entry, ctx, bus, redis);
    await reply(redis, replyKey, { status: 'ok', data });
  } catch (err) {
    await reply(redis, replyKey, { status: 'error', error: toReplyError(err) });
    if (!(err instanceof EngineError)) {
      log.error({ err, action: entry.action }, 'request failed with unexpected error');
    }
  }
}

async function reply(redis: Redis, replyKey: string, body: ReplyOk | ReplyErr): Promise<void> {
  await redis.lpush(replyKey, JSON.stringify(body));
  await redis.expire(replyKey, 30);
}

async function dispatch(
  entry: RequestEntry,
  ctx: EngineContext,
  bus: EventBus,
  redis: Redis,
): Promise<unknown> {
  const { action, userId, payload } = entry;
  switch (action) {
    case 'place_order': {
      const input = payload as { marketId: string };
      const result = await placeOrder(payload, userId, ctx);
      await publishOrderEffects(
        bus,
        ctx.prisma,
        ctx,
        redis,
        input.marketId,
        result.order,
        result.fills,
      );
      return { order: serializeOrder(result.order), fills: result.fills.map(serializeTrade) };
    }

    case 'cancel_order': {
      const { orderId } = payload as { orderId: string };
      const updated = await cancelOrder(orderId, userId, ctx);
      await publishCancelEffects(bus, ctx.prisma, ctx, redis, updated);
      return { order: serializeOrder(updated) };
    }

    case 'close_market': {
      const { marketId } = payload as { marketId: string };
      const result = await closeMarket(ctx.prisma, marketId);
      await clearBook(ctx, marketId);
      await publishLifecycleEffects(
        bus,
        ctx.prisma,
        ctx,
        redis,
        marketId,
        result.canceledOrders.map((o) => o.userId),
      );
      return {
        market: serializeMarket(result.market),
        canceledOrderIds: result.canceledOrders.map((o) => o.id),
      };
    }

    case 'resolve_market': {
      const { marketId, outcome } = payload as {
        marketId: string;
        outcome: 'YES' | 'NO' | 'INVALID';
      };
      const result = await resolveMarket(ctx.prisma, marketId, outcome);
      await clearBook(ctx, marketId);
      await publishLifecycleEffects(
        bus,
        ctx.prisma,
        ctx,
        redis,
        marketId,
        result.payouts.map((p) => p.userId),
      );
      return { market: serializeMarket(result.market), payouts: result.payouts };
    }

    case 'void_market': {
      const { marketId, reason } = payload as { marketId: string; reason: string };
      const result = await voidMarket(ctx.prisma, marketId, reason);
      await clearBook(ctx, marketId);
      await publishLifecycleEffects(
        bus,
        ctx.prisma,
        ctx,
        redis,
        marketId,
        result.refunds.map((r) => r.userId),
      );
      return { market: serializeMarket(result.market), refunds: result.refunds };
    }

    case 'create_market': {
      const market = await createMarket(ctx.prisma, payload as Parameters<typeof createMarket>[1]);
      // Make sure the matcher has a (empty) book ready for the new market.
      if (!ctx.books.has(market.id)) {
        ctx.books.set(market.id, new OrderBook(market.id));
      }
      return { market: serializeMarket(market) };
    }

    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown matcher action: ${String(_exhaustive)}`);
    }
  }
}

/** Drop the in-memory book and Redis ZSETs for a market that's no longer OPEN. */
async function clearBook(ctx: EngineContext, marketId: string): Promise<void> {
  ctx.books.delete(marketId);
  if (ctx.redis) {
    await Promise.all([
      ctx.redis.del(keyFor(marketId, 'YES', 'BUY')),
      ctx.redis.del(keyFor(marketId, 'YES', 'SELL')),
      ctx.redis.del(keyFor(marketId, 'NO', 'BUY')),
      ctx.redis.del(keyFor(marketId, 'NO', 'SELL')),
    ]);
  }
}

function toReplyError(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof OrderNotFoundError) {
    return { code: err.code, message: err.message, status: 404 };
  }
  if (err instanceof EngineError) {
    return { code: err.code, message: err.message, status: statusForEngineCode(err.code) };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: err instanceof Error ? err.message : 'Internal error',
    status: 500,
  };
}

/** Mirror of apps/api/src/lib/errors.ts so the API can rebuild the HTTP status. */
function statusForEngineCode(code: string): number {
  switch (code) {
    case 'INVALID_PRICE':
      return 400;
    case 'INVALID_ORDER':
      return 422;
    case 'INSUFFICIENT_FUNDS':
    case 'INSUFFICIENT_POSITION':
      return 402;
    case 'MARKET_NOT_OPEN':
    case 'SELF_TRADE':
    case 'MARKET_ALREADY_CLOSED':
    case 'MARKET_ALREADY_RESOLVED':
      return 409;
    case 'ORDER_NOT_FOUND':
    case 'MARKET_NOT_FOUND':
      return 404;
    default:
      return 400;
  }
}

interface MarketRow {
  id: string;
  type: string;
  question: string;
  line: number | null;
  status: string;
  outcome: string | null;
  closedAt: Date | null;
  resolvedAt: Date | null;
  eventId: string;
}

function serializeMarket(m: MarketRow) {
  return {
    id: m.id,
    type: m.type,
    question: m.question,
    line: m.line,
    status: m.status,
    outcome: m.outcome,
    closedAt: m.closedAt?.toISOString() ?? null,
    resolvedAt: m.resolvedAt?.toISOString() ?? null,
    eventId: m.eventId,
  };
}

function serializeOrder(o: Order) {
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

function serializeTrade(t: Trade) {
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

// Production entrypoint — only runs when this module is the process main, not
// when imported (e.g. by API integration tests).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runMatcher()
    .then((handle) => {
      const shutdown = async (): Promise<void> => {
        defaultLog.info('shutting down');
        await handle.stop();
        await prisma.$disconnect();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err: unknown) => {
      defaultLog.error({ err }, 'fatal startup error');
      process.exit(1);
    });
}
