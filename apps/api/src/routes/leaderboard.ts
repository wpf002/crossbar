import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

/**
 * Simple leaderboards derived from existing tables:
 *  - top traders by realized P&L (sum of Position.realizedPnl)
 *  - top traders by 24h volume (sum of price * quantity over Trade rows where
 *    they were buyer or seller)
 *
 * Both are read-only, public-safe (no email/sensitive data exposed).
 */
export default async function leaderboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/leaderboard', async () => {
    const [pnlAgg, recentTrades] = await Promise.all([
      prisma.position.groupBy({
        by: ['userId'],
        _sum: { realizedPnl: true },
        orderBy: { _sum: { realizedPnl: 'desc' } },
        take: 50,
      }),
      prisma.trade.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        select: { buyerUserId: true, sellerUserId: true, price: true, quantity: true },
      }),
    ]);

    const userIds = new Set<string>(pnlAgg.map((p) => p.userId));
    const volumeByUser = new Map<string, number>();
    for (const t of recentTrades) {
      const vol = t.price * t.quantity;
      volumeByUser.set(t.buyerUserId, (volumeByUser.get(t.buyerUserId) ?? 0) + vol);
      volumeByUser.set(t.sellerUserId, (volumeByUser.get(t.sellerUserId) ?? 0) + vol);
      userIds.add(t.buyerUserId);
      userIds.add(t.sellerUserId);
    }

    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, username: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.username]));

    const byPnl = pnlAgg
      .filter((p) => (p._sum.realizedPnl ?? 0) !== 0)
      .map((p) => ({
        userId: p.userId,
        username: nameById.get(p.userId) ?? '?',
        realizedPnl: p._sum.realizedPnl ?? 0,
      }))
      .slice(0, 20);

    const byVolume = [...volumeByUser.entries()]
      .map(([userId, volume]) => ({
        userId,
        username: nameById.get(userId) ?? '?',
        volume24h: volume,
      }))
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 20);

    return { byPnl, byVolume };
  });
}
