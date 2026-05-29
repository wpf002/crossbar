import { describe, it, expect } from 'vitest';
import pino from 'pino';
import type { Event } from '@prisma/client';
import { prisma } from '@crossbar/db';
import type { SportEvent } from '@crossbar/shared';
import { ingestSport } from './ingest.js';
import { ensurePeriodMarkets } from './period-markets.js';
import { applyEventTransitions } from './transitions.js';

const log = pino({ level: 'silent' });

function nflEvt(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    externalId: 'nfl-1',
    sportId: 'nfl',
    homeTeam: 'Bills',
    awayTeam: 'Jets',
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'LIVE',
    ...overrides,
  };
}

async function ingest(ev: SportEvent): Promise<Event> {
  const result = await ingestSport('nfl', { prisma, log, fetchScoreboard: async () => [ev] });
  return result.updatedEvents[0]!;
}

describe('ensurePeriodMarkets', () => {
  it('creates one market per regulation period (NFL = 4), idempotently', async () => {
    const event = await ingest(nflEvt({ period: 1 }));

    expect(await ensurePeriodMarkets(event, { prisma, log })).toBe(4);
    expect(await ensurePeriodMarkets(event, { prisma, log })).toBe(0);

    const periods = await prisma.market.findMany({
      where: { type: 'PERIOD_WINNER' },
      orderBy: { period: 'asc' },
    });
    expect(periods.map((m) => m.period)).toEqual([1, 2, 3, 4]);
    expect(periods[0]!.question).toContain('1st quarter');
  });
});

describe('per-period resolution windows', () => {
  it('resolves a period market when its period ends, the rest at FINAL', async () => {
    // Q1 done (Bills 7, Jets 3); game in Q2.
    let event = await ingest(
      nflEvt({ period: 2, homeLinescores: [7], awayLinescores: [3], homeScore: 7, awayScore: 3 }),
    );
    await ensurePeriodMarkets(event, { prisma, log });

    await applyEventTransitions(event, { prisma, log });

    const q1 = await prisma.market.findFirstOrThrow({ where: { type: 'PERIOD_WINNER', period: 1 } });
    expect(q1.status).toBe('RESOLVED');
    expect(q1.outcome).toBe('YES'); // 7 > 3
    const q2 = await prisma.market.findFirstOrThrow({ where: { type: 'PERIOD_WINNER', period: 2 } });
    expect(q2.status).toBe('OPEN'); // period 2 not over yet

    // Game ends with full line: Bills 7/0/10/3, Jets 3/7/7/14.
    event = await ingest(
      nflEvt({
        status: 'FINAL',
        period: 4,
        homeLinescores: [7, 0, 10, 3],
        awayLinescores: [3, 7, 7, 14],
        homeScore: 20,
        awayScore: 31,
      }),
    );
    await applyEventTransitions(event, { prisma, log });

    const all = await prisma.market.findMany({
      where: { type: 'PERIOD_WINNER' },
      orderBy: { period: 'asc' },
    });
    expect(all.map((m) => m.outcome)).toEqual(['YES', 'NO', 'YES', 'NO']);
    expect(all.every((m) => m.status === 'RESOLVED')).toBe(true);
  });
});
