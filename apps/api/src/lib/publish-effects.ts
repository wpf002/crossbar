import type { Order, PrismaClient, Trade } from '@crossbar/db';
import type { EngineContext } from '@crossbar/engine';
import { OrderBook } from '@crossbar/engine';
import type { EventBus } from './events.js';

/**
 * After an order is placed (or canceled), republish all derived state that
 * SSE subscribers care about. Keeps publishing in the API layer so the engine
 * stays a pure matching primitive.
 */
export async function publishOrderEffects(
  bus: EventBus,
  prisma: PrismaClient,
  engineCtx: EngineContext,
  marketId: string,
  order: Order,
  fills: Trade[],
): Promise<void> {
  if (!bus.redisUrl) return;

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
  const book = engineCtx.books.get(marketId) ?? new OrderBook(marketId);
  await bus.publishBook(marketId, book.snapshot());

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
  order: Order,
): Promise<void> {
  if (!bus.redisUrl) return;

  await bus.publishOrder(order.userId, order);

  const wallet = await prisma.wallet.findUnique({ where: { userId: order.userId } });
  if (wallet) await bus.publishWallet(order.userId, wallet);

  const book = engineCtx.books.get(order.marketId) ?? new OrderBook(order.marketId);
  await bus.publishBook(order.marketId, book.snapshot());
}

/**
 * Lifecycle effects: close, resolve, or void a market. Refresh book snapshot
 * (now empty for CLOSED+) and broadcast wallet/position for each affected user.
 */
export async function publishLifecycleEffects(
  bus: EventBus,
  prisma: PrismaClient,
  engineCtx: EngineContext,
  marketId: string,
  affectedUserIds: string[],
): Promise<void> {
  if (!bus.redisUrl) return;

  const book = engineCtx.books.get(marketId) ?? new OrderBook(marketId);
  await bus.publishBook(marketId, book.snapshot());

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
