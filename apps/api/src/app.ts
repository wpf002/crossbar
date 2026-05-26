import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { OrderBook, type EngineContext } from '@crossbar/engine';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import healthRoutes from './routes/health.js';
import sportsRoutes from './routes/sports.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import marketsRoutes from './routes/markets.js';
import ordersRoutes from './routes/orders.js';
import commentsRoutes from './routes/comments.js';
import leaderboardRoutes from './routes/leaderboard.js';
import botsRoutes from './routes/bots.js';
import { prisma } from './lib/prisma.js';
import { mapError } from './lib/errors.js';
import { loadEnv, type Env } from './env.js';

export interface BuildAppOptions {
  env?: Env;
  /** Override the engine context (useful in tests). */
  engineCtx?: EngineContext;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();

  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            transport:
              env.NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
          },
  });

  const engineCtx: EngineContext = opts.engineCtx ?? {
    prisma,
    books: new Map(),
  };

  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = mapError(err);
    if (status >= 500) app.log.error({ err }, 'unhandled error');
    return reply.code(status).send(body);
  });

  await app.register(sensible);
  await app.register(cors, { origin: true });
  await app.register(authPlugin, { secret: env.JWT_SECRET });
  await app.register(rateLimitPlugin);

  await app.register(healthRoutes);
  await app.register(sportsRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes, { prefix: '/me' });
  await app.register(marketsRoutes(engineCtx), { prefix: '/markets' });
  await app.register(ordersRoutes(engineCtx), { prefix: '/orders' });
  await app.register(commentsRoutes);
  await app.register(leaderboardRoutes);
  await app.register(botsRoutes);

  return app;
}

/** Build books from currently-OPEN orders in Postgres. */
export async function hydrateBooksFromDb(): Promise<Map<string, OrderBook>> {
  const openMarkets = await prisma.market.findMany({
    where: { status: 'OPEN' },
    select: { id: true },
  });

  const books = new Map<string, OrderBook>();
  for (const { id } of openMarkets) {
    const book = new OrderBook(id);
    books.set(id, book);
    const orders = await prisma.order.findMany({
      where: {
        marketId: id,
        status: { in: ['OPEN', 'PARTIAL'] },
        outcome: { in: ['YES', 'NO'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const o of orders) {
      if (o.outcome === 'INVALID') continue;
      const remaining = o.quantity - o.filled;
      if (remaining <= 0) continue;
      book.addOrder({
        id: o.id,
        userId: o.userId,
        side: o.side,
        outcome: o.outcome,
        price: o.price,
        remaining,
        ts: o.createdAt.getTime(),
      });
    }
  }
  return books;
}
