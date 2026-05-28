import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Redis from 'ioredis';
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
import sseRoutes from './routes/sse.js';
import adminRoutes from './routes/admin.js';
import { mapError } from './lib/errors.js';
import { loadEnv, type Env } from './env.js';
import { createEventBus, nullEventBus, type EventBus } from './lib/events.js';
import {
  createMatcherClient,
  nullMatcherClient,
  type MatcherClient,
} from './lib/matcher-client.js';

export interface BuildAppOptions {
  env?: Env;
  /** Override the event bus (useful in tests). */
  bus?: EventBus;
  /** Override the matcher client (useful in tests). */
  matcher?: MatcherClient;
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

  // Post-cutover the API holds no in-memory books. It talks to the matcher over
  // a Redis stream and reads book snapshots from Redis keys the matcher writes.
  const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 }) : null;
  redis?.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.warn('[redis] error:', err.message);
  });

  const bus: EventBus =
    opts.bus ?? (env.REDIS_URL ? createEventBus(env.REDIS_URL) : nullEventBus());

  const matcher: MatcherClient =
    opts.matcher ?? (env.REDIS_URL ? createMatcherClient(env.REDIS_URL) : nullMatcherClient());

  app.addHook('onClose', async () => {
    await bus.close();
    await matcher.close();
    if (redis) redis.disconnect();
  });

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
  await app.register(marketsRoutes(redis), { prefix: '/markets' });
  await app.register(ordersRoutes(matcher), { prefix: '/orders' });
  await app.register(commentsRoutes);
  await app.register(leaderboardRoutes);
  await app.register(botsRoutes);
  await app.register(sseRoutes({ redis, bus }));
  await app.register(adminRoutes({ matcher, bus }), { prefix: '/admin' });

  return app;
}
