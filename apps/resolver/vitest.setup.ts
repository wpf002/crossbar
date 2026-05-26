import { afterAll, beforeEach } from 'vitest';
import { prisma } from '@crossbar/db';

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "TradeFill",
      "Trade",
      "Order",
      "Position",
      "Wallet",
      "Market",
      "Event",
      "Sport",
      "User"
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});
