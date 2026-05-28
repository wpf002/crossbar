import type Redis from 'ioredis';
import type { Order, PrismaClient, Trade } from '@crossbar/db';
import type { EngineContext } from '@crossbar/engine';
import { OrderBook } from '@crossbar/engine';
import { bookSnapshotKey, type EventBus } from './events.js';

/**
 * After an order is placed (or canceled), republish all derived state that
 * SSE subscribers care about. Moved here from the API as part of the matcher
 * cutover — the matcher owns the in-memory book, so it owns the broadcast.
 *
 * Every book change also writes the latest snapshot to a plain Redis key so a
 * freshly-connected SSE client (in the API) can read the current book without
 * the API holding any in-memory state.
 */
export async function publishOrderEffects(
  bus: EventBus,
  prisma: PrismaClient,
  engineCtx: EngineContext,
  redis: Redis,
  marketId: string,
  order: Order,
  fills: Trade[],
): Promise<void> {
  // 1. Order status (always)
  await bus.publishOrder(order.userId, order);

  // 2. Per-fill: trade, lastTrade, plus position+wallet for both counterparties
  const touchedUsers = new Set<string>([order.userId]);
  for (const trade of fills) {
    await bus.publishTrade(marketId, trade);
    await bus.publishLastTrade(marketId, trade.price);
    touchedUsers.add(trade.buyerUserId);
    touchedUsers.add(trade.sellerUserId);
  }

  // 3. Book snapshot from the in-memory book.
  await writeBookSnapshot(bus, redis, engineCtx, marketId);

  // 4. Wallet + market position for every user who saw state change.
  await Promise.all(
    [...touchedUsers].map(async (uid) => {
      const [wallet, position] = await Promise.all([
        prisma.wallet.findUnique({ where: { userId: uid } }),
        prisma.position.findUnique({
          where: { userId_marketId: { userId: uid, marketId } },
        }),
      ]);
      if (wallet) await bus.publishWallet(uid, wallet);
      if (position) await bus.publishPosition(uid, position);
    }),
  );
}

/** Cancel: order update, wallet update (for the owner), book snapshot. */
export async function publishCancelEffects(
  bus: EventBus,
  prisma: PrismaClient,
  engineCtx: EngineContext,
  redis: Redis,
  order: Order,
): Promise<void> {
  await bus.publishOrder(order.userId, order);

  const wallet = await prisma.wallet.findUnique({ where: { userId: order.userId } });
  if (wallet) await bus.publishWallet(order.userId, wallet);

  await writeBookSnapshot(bus, redis, engineCtx, order.marketId);
}

/**
 * Lifecycle effects: close, resolve, or void a market. Refresh book snapshot
 * (now empty for CLOSED+) and broadcast wallet/position for each affected user.
 */
export async function publishLifecycleEffects(
  bus: EventBus,
  prisma: PrismaClient,
  engineCtx: EngineContext,
  redis: Redis,
  marketId: string,
  affectedUserIds: string[],
): Promise<void> {
  await writeBookSnapshot(bus, redis, engineCtx, marketId);

  const unique = [...new Set(affectedUserIds)];
  await Promise.all(
    unique.map(async (uid) => {
      const [wallet, position] = await Promise.all([
        prisma.wallet.findUnique({ where: { userId: uid } }),
        prisma.position.findUnique({
          where: { userId_marketId: { userId: uid, marketId } },
        }),
      ]);
      if (wallet) await bus.publishWallet(uid, wallet);
      if (position) await bus.publishPosition(uid, position);
    }),
  );
}

/** Publish a book snapshot to the pub/sub channel AND persist it to a key. */
async function writeBookSnapshot(
  bus: EventBus,
  redis: Redis,
  engineCtx: EngineContext,
  marketId: string,
): Promise<void> {
  const book = engineCtx.books.get(marketId) ?? new OrderBook(marketId);
  const snapshot = book.snapshot();
  await bus.publishBook(marketId, snapshot);
  try {
    await redis.set(bookSnapshotKey(marketId), JSON.stringify(snapshot));
  } catch {
    // best-effort: a missing snapshot key just means SSE first-connect is empty
  }
}
