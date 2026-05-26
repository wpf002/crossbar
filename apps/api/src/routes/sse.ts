import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Redis from 'ioredis';
import { OrderBook, type EngineContext } from '@crossbar/engine';
import { prisma } from '../lib/prisma.js';
import {
  LAST_TRADE_CHANNEL,
  bookChannel,
  orderChannel,
  positionChannelPattern,
  tradesChannel,
  walletChannel,
  type EventBus,
} from '../lib/events.js';
interface SseDeps {
  engineCtx: EngineContext;
  bus: EventBus;
}

interface JwtPayload {
  sub: string;
  email: string;
  isAdmin?: boolean;
}

interface FastifyJwtish {
  jwt: { verify: (token: string) => JwtPayload };
}

interface SseConnection {
  send(event: string, data: unknown): void;
  comment(text: string): void;
  close(): void;
}

function openSse(reply: FastifyReply): SseConnection {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no');
  // Disable Fastify's default reply lifecycle — we're streaming until the
  // client hangs up.
  reply.hijack();
  reply.raw.flushHeaders();

  const send = (event: string, data: unknown): void => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const comment = (text: string): void => {
    reply.raw.write(`: ${text}\n\n`);
  };
  return {
    send,
    comment,
    close: () => {
      try {
        reply.raw.end();
      } catch {
        // socket already closed
      }
    },
  };
}

/**
 * Create a fresh subscriber. ioredis Sub clients block on `subscribe` so we
 * give each SSE connection its own instance, then clean up on disconnect.
 */
function subscriberFor(redisUrl: string): Redis {
  return new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: null });
}

export default function sseRoutes(deps: SseDeps) {
  const { engineCtx, bus } = deps;

  return async function (fastify: FastifyInstance): Promise<void> {
    // ─── public: per-market book + trades ────────────────────────────────
    fastify.get<{ Params: { id: string } }>(
      '/sse/markets/:id',
      async (req, reply) => {
        const marketId = req.params.id;
        const exists = await prisma.market.findUnique({
          where: { id: marketId },
          select: { id: true },
        });
        if (!exists) {
          reply.code(404).send({ error: 'NOT_FOUND', message: 'Market not found' });
          return;
        }

        const conn = openSse(reply);
        const book = engineCtx.books.get(marketId) ?? new OrderBook(marketId);
        conn.send('book', book.snapshot());

        if (!bus.redisUrl) {
          conn.comment('pubsub disabled — book snapshot above is one-shot');
          // Keep the connection alive so the client can rely on it; ping every 20s.
          attachPing(conn, req);
          return;
        }

        const sub = subscriberFor(bus.redisUrl);
        // Attach the handler BEFORE subscribing — once SUBSCRIBE returns,
        // ioredis starts emitting 'message' events and they'd be lost
        // otherwise.
        sub.on('message', (channel, message) => {
          if (channel === bookChannel(marketId)) {
            conn.send('book', JSON.parse(message));
          } else if (channel === tradesChannel(marketId)) {
            conn.send('trade', JSON.parse(message));
          }
        });
        await sub.subscribe(bookChannel(marketId), tradesChannel(marketId));
        conn.comment('subscribed');
        attachPing(conn, req, () => {
          sub.disconnect();
        });
      },
    );

    // ─── public: cross-market last-trade ticker ──────────────────────────
    fastify.get('/sse/markets', async (req, reply) => {
      const conn = openSse(reply);
      conn.comment('connected');

      if (!bus.redisUrl) {
        attachPing(conn, req);
        return;
      }

      const sub = subscriberFor(bus.redisUrl);
      sub.on('message', (channel, message) => {
        if (channel === LAST_TRADE_CHANNEL) {
          conn.send('lastTrade', JSON.parse(message));
        }
      });
      await sub.subscribe(LAST_TRADE_CHANNEL);
      conn.comment('subscribed');
      attachPing(conn, req, () => {
        sub.disconnect();
      });
    });

    // ─── auth: per-user wallet + positions + orders ──────────────────────
    fastify.get<{ Querystring: { token?: string } }>(
      '/sse/me',
      async (req, reply) => {
        const token = req.query.token ?? bearerToken(req);
        if (!token) {
          reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing token' });
          return;
        }
        let payload: JwtPayload;
        try {
          payload = (fastify as unknown as FastifyJwtish).jwt.verify(token);
        } catch {
          reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid token' });
          return;
        }
        const userId = payload.sub;

        const conn = openSse(reply);
        conn.comment('connected');

        if (!bus.redisUrl) {
          attachPing(conn, req);
          return;
        }

        const sub = subscriberFor(bus.redisUrl);
        sub.on('message', (channel, message) => {
          if (channel === walletChannel(userId)) {
            conn.send('wallet', JSON.parse(message));
          } else if (channel === orderChannel(userId)) {
            conn.send('order', JSON.parse(message));
          }
        });
        sub.on('pmessage', (_pattern, channel, message) => {
          if (channel.startsWith(`user:${userId}:position:`)) {
            conn.send('position', JSON.parse(message));
          }
        });
        await sub.subscribe(walletChannel(userId), orderChannel(userId));
        await sub.psubscribe(positionChannelPattern(userId));
        conn.comment('subscribed');

        attachPing(conn, req, () => {
          sub.disconnect();
        });
      },
    );
  };
}

function attachPing(
  conn: SseConnection,
  req: FastifyRequest,
  onClose?: () => void,
): void {
  const ping = setInterval(() => {
    try {
      conn.comment('ping');
    } catch {
      clearInterval(ping);
    }
  }, 20_000);
  req.raw.on('close', () => {
    clearInterval(ping);
    if (onClose) onClose();
    conn.close();
  });
}

function bearerToken(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const [scheme, value] = h.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  return value;
}
