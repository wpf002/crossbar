import pino from 'pino';
import Redis from 'ioredis';
import { prisma } from '@crossbar/db';
import {
  hydrateFromPostgres,
  countOpenOrdersPerMarket,
  placeOrder,
  type EngineContext,
} from '@crossbar/engine';

const log = pino({
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl);

  log.info('crossbar matcher booting');

  const books = await hydrateFromPostgres(prisma, redis);
  const counts = await countOpenOrdersPerMarket(prisma);

  if (books.size === 0) {
    log.info('no OPEN markets — nothing to hydrate');
  } else {
    for (const [marketId, book] of books) {
      log.info({ marketId, openOrders: counts.get(marketId) ?? 0 }, 'hydrated market');
      void book; // referenced for clarity
    }
  }

  const ctx: EngineContext = { prisma, redis, books };

  // Subscribe to the incoming-orders channel. The API will publish JSON like:
  //   { "userId": "...", "input": { marketId, side, outcome, price, quantity } }
  const sub = new Redis(redisUrl);
  await sub.subscribe('orders:incoming');
  sub.on('message', (channel, raw) => {
    if (channel !== 'orders:incoming') return;
    void handleMessage(raw, ctx, log);
  });

  log.info('listening on Redis channel orders:incoming');

  const shutdown = async (): Promise<void> => {
    log.info('shutting down');
    await sub.quit();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleMessage(raw: string, ctx: EngineContext, log: pino.Logger): Promise<void> {
  let parsed: { userId: string; input: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.error({ err, raw }, 'malformed orders:incoming payload');
    return;
  }
  try {
    const result = await placeOrder(parsed.input, parsed.userId, ctx);
    log.info({ orderId: result.order.id, fills: result.fills.length }, 'placed order');
  } catch (err) {
    log.warn({ err }, 'order rejected');
  }
}

main().catch((err: unknown) => {
  log.error({ err }, 'fatal startup error');
  process.exit(1);
});
