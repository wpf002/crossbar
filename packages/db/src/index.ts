import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Walk up from cwd looking for a .env so callers can import @crossbar/db
// from any cwd in the monorepo without having to set DATABASE_URL themselves.
function loadDotenv(): void {
  if (process.env.DATABASE_URL) return;
  let dir = resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // Malformed .env — let the missing-DATABASE_URL check below surface it.
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function makeClient(): PrismaClient {
  loadDotenv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  // Prisma 7 requires a driver adapter for direct DB connections.
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const prisma = global.__prisma ?? makeClient();

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
