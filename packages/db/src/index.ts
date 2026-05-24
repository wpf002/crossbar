import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV === 'development') {
  global.__prisma = prisma;
}

export * from '@prisma/client';

// ─── Helper queries ──────────────────────────────────────────────────────

export async function getOpenOrders(marketId: string) {
  return prisma.order.findMany({
    where: {
      marketId,
      status: { in: ['OPEN', 'PARTIAL'] },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getUserPosition(userId: string, marketId: string) {
  return prisma.position.findUnique({
    where: { userId_marketId: { userId, marketId } },
  });
}

export async function getUserWallet(userId: string) {
  return prisma.wallet.findUnique({ where: { userId } });
}
