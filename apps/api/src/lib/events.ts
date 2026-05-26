import Redis from 'ioredis';
import type { Order, Position, Trade } from '@crossbar/db';
import type { OrderBookSnapshot } from '@crossbar/shared';

export interface SerializedTrade {
  id: string;
  marketId: string;
  outcome: string;
  price: number;
  quantity: number;
  buyerUserId: string;
  sellerUserId: string;
  createdAt: string;
}

export interface SerializedOrder {
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

export interface SerializedPosition {
  marketId: string;
  yesShares: number;
  noShares: number;
  avgYesCost: number | null;
  avgNoCost: number | null;
  realizedPnl: number;
}

export interface EventBus {
  publishBook(marketId: string, snapshot: OrderBookSnapshot): Promise<void>;
  publishTrade(marketId: string, trade: Trade): Promise<void>;
  publishLastTrade(marketId: string, price: number): Promise<void>;
  publishWallet(userId: string, wallet: { balance: number; reserved: number }): Promise<void>;
  publishPosition(userId: string, position: Position): Promise<void>;
  publishOrder(userId: string, order: Order): Promise<void>;
  /** Connection used for publishing (null when no REDIS_URL configured). */
  readonly redisUrl: string | null;
  close(): Promise<void>;
}

export function bookChannel(marketId: string): string {
  return `market:${marketId}:book`;
}
export function tradesChannel(marketId: string): string {
  return `market:${marketId}:trades`;
}
export const LAST_TRADE_CHANNEL = 'market:lastTrade';
export function walletChannel(userId: string): string {
  return `user:${userId}:wallet`;
}
export function positionChannelPattern(userId: string): string {
  return `user:${userId}:position:*`;
}
export function positionChannel(userId: string, marketId: string): string {
  return `user:${userId}:position:${marketId}`;
}
export function orderChannel(userId: string): string {
  return `user:${userId}:order`;
}

function serializeTrade(t: Trade): SerializedTrade {
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

function serializeOrder(o: Order): SerializedOrder {
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

function serializePosition(p: Position): SerializedPosition {
  return {
    marketId: p.marketId,
    yesShares: p.yesShares,
    noShares: p.noShares,
    avgYesCost: p.avgYesCost,
    avgNoCost: p.avgNoCost,
    realizedPnl: p.realizedPnl,
  };
}

/**
 * Create an event publisher. All publishes are fire-and-forget: errors are
 * logged but never thrown, so a flaky Redis can't take down request handlers.
 * If `redisUrl` is undefined the bus becomes a no-op.
 */
export function createEventBus(redisUrl?: string): EventBus {
  const client: Redis | null = redisUrl
    ? new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 })
    : null;
  client?.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.warn('[events] redis error:', err.message);
  });

  async function safePublish(channel: string, payload: unknown): Promise<void> {
    if (!client) return;
    try {
      await client.publish(channel, JSON.stringify(payload));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[events] publish failed', { channel, err });
    }
  }

  return {
    redisUrl: redisUrl ?? null,
    publishBook: (marketId, snapshot) => safePublish(bookChannel(marketId), snapshot),
    publishTrade: (marketId, trade) => safePublish(tradesChannel(marketId), serializeTrade(trade)),
    publishLastTrade: (marketId, price) =>
      safePublish(LAST_TRADE_CHANNEL, { marketId, price, ts: Date.now() }),
    publishWallet: (userId, wallet) =>
      safePublish(walletChannel(userId), {
        balance: wallet.balance,
        reserved: wallet.reserved,
      }),
    publishPosition: (userId, position) =>
      safePublish(positionChannel(userId, position.marketId), serializePosition(position)),
    publishOrder: (userId, order) => safePublish(orderChannel(userId), serializeOrder(order)),
    async close() {
      if (client) await client.quit().catch(() => undefined);
    },
  };
}

/** No-op bus for tests that don't care about pub/sub. */
export function nullEventBus(): EventBus {
  return {
    redisUrl: null,
    publishBook: async () => undefined,
    publishTrade: async () => undefined,
    publishLastTrade: async () => undefined,
    publishWallet: async () => undefined,
    publishPosition: async () => undefined,
    publishOrder: async () => undefined,
    close: async () => undefined,
  };
}
