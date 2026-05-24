import { prisma } from '@crossbar/db';
import type { EngineContext } from './matcher.js';

export interface Fixture {
  ctx: EngineContext;
  userA: string;
  userB: string;
  userC: string;
  marketId: string;
  cleanup: () => Promise<void>;
}

export async function makeFixture(opts?: { balanceCents?: number }): Promise<Fixture> {
  const balance = opts?.balanceCents ?? 100_000;

  await prisma.sport.upsert({
    where: { id: 'mlb' },
    update: {},
    create: { id: 'mlb', name: 'MLB' },
  });

  const event = await prisma.event.create({
    data: {
      sportId: 'mlb',
      externalId: `evt-${Date.now()}-${Math.random()}`,
      homeTeam: 'HOME',
      awayTeam: 'AWAY',
      startsAt: new Date(Date.now() + 3600_000),
    },
  });

  const market = await prisma.market.create({
    data: {
      eventId: event.id,
      type: 'MONEYLINE',
      question: 'Will HOME beat AWAY?',
      yesLabel: 'HOME wins',
      noLabel: 'AWAY wins',
    },
  });

  const [a, b, c] = await Promise.all([
    mkUser('a', balance),
    mkUser('b', balance),
    mkUser('c', balance),
  ]);

  return {
    ctx: { prisma, books: new Map() },
    userA: a,
    userB: b,
    userC: c,
    marketId: market.id,
    cleanup: async () => {
      /* per-test truncate happens in vitest.setup.ts */
    },
  };
}

let userCounter = 0;

async function mkUser(label: string, balance: number): Promise<string> {
  userCounter += 1;
  const u = await prisma.user.create({
    data: {
      email: `${label}-${userCounter}-${Date.now()}@test.local`,
      username: `${label}-${userCounter}-${Date.now()}`,
      wallet: { create: { balance, reserved: 0 } },
    },
  });
  return u.id;
}
