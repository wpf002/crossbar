import { afterAll, beforeEach } from 'vitest';
import { prisma } from '@crossbar/db';

beforeEach(async () => {
  // Wipe in dependency order. RESTART IDENTITY isn't needed (cuid PKs).
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "TradeFill",
      "Trade",
      "Order",
      "Position",
      "Wallet",
      "Market",
      "PlayerStat",
      "Player",
      "Event",
      "Sport",
      "User"
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});
