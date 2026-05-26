import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { prisma } from '@crossbar/db';
import type { SportEvent } from '@crossbar/shared';
import { ingestSport } from './ingest.js';

const log = pino({ level: 'silent' });

function evt(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    externalId: 'espn-1',
    sportId: 'mlb',
    homeTeam: 'Yankees',
    awayTeam: 'Red Sox',
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'SCHEDULED',
    ...overrides,
  };
}

describe('ingestSport', () => {
  it('creates Event + MONEYLINE for a brand-new game without odds', async () => {
    const fetchScoreboard = async () => [evt()];

    const result = await ingestSport('mlb', { prisma, log, fetchScoreboard });

    expect(result.fetched).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.marketsCreated).toBe(1);

    const events = await prisma.event.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.homeTeam).toBe('Yankees');

    const markets = await prisma.market.findMany();
    expect(markets).toHaveLength(1);
    expect(markets[0]?.type).toBe('MONEYLINE');
    expect(markets[0]?.question).toBe('Will the Yankees beat the Red Sox?');
    expect(markets[0]?.yesLabel).toBe('Yankees wins');
  });

  it('creates MONEYLINE + TOTAL + SPREAD when odds are present', async () => {
    const fetchScoreboard = async () => [
      evt({ overUnder: 8.5, spread: -1.5 }),
    ];

    const result = await ingestSport('mlb', { prisma, log, fetchScoreboard });
    expect(result.marketsCreated).toBe(3);

    const markets = await prisma.market.findMany({ orderBy: { type: 'asc' } });
    expect(markets.map((m) => m.type).sort()).toEqual(['MONEYLINE', 'SPREAD', 'TOTAL']);

    const total = markets.find((m) => m.type === 'TOTAL');
    expect(total?.line).toBe(8.5);
    expect(total?.question).toBe('Will combined score go OVER 8.5?');
    expect(total?.yesLabel).toBe('Over 8.5');

    const spread = markets.find((m) => m.type === 'SPREAD');
    expect(spread?.line).toBe(-1.5);
    expect(spread?.question).toBe('Will Yankees cover -1.5?');
    expect(spread?.yesLabel).toBe('Yankees -1.5');
    expect(spread?.noLabel).toBe('Red Sox +1.5');
  });

  it('formats positive spread with + sign', async () => {
    const fetchScoreboard = async () => [evt({ spread: 3.5 })];
    await ingestSport('mlb', { prisma, log, fetchScoreboard });

    const spread = await prisma.market.findFirstOrThrow({ where: { type: 'SPREAD' } });
    expect(spread.question).toBe('Will Yankees cover +3.5?');
    expect(spread.yesLabel).toBe('Yankees +3.5');
    expect(spread.noLabel).toBe('Red Sox -3.5');
  });

  it('is idempotent — second run does not duplicate events or markets', async () => {
    const fetchScoreboard = async () => [evt({ overUnder: 7.5, spread: -1.5 })];

    await ingestSport('mlb', { prisma, log, fetchScoreboard });
    await ingestSport('mlb', { prisma, log, fetchScoreboard });

    const events = await prisma.event.findMany();
    const markets = await prisma.market.findMany();
    expect(events).toHaveLength(1);
    expect(markets).toHaveLength(3);
  });

  it('updates scores on subsequent runs without recreating markets', async () => {
    const first: SportEvent = evt({ status: 'LIVE', homeScore: 2, awayScore: 1 });
    const second: SportEvent = evt({ status: 'LIVE', homeScore: 5, awayScore: 3 });

    await ingestSport('mlb', { prisma, log, fetchScoreboard: async () => [first] });
    const marketsAfterFirst = await prisma.market.findMany();
    expect(marketsAfterFirst).toHaveLength(1);

    await ingestSport('mlb', { prisma, log, fetchScoreboard: async () => [second] });

    const updated = await prisma.event.findFirstOrThrow();
    expect(updated.homeScore).toBe(5);
    expect(updated.awayScore).toBe(3);

    const marketsAfter = await prisma.market.findMany();
    expect(marketsAfter).toHaveLength(1);
  });

  it('ensures the Sport row exists even when feed is empty', async () => {
    await ingestSport('nfl', { prisma, log, fetchScoreboard: async () => [] });
    const sport = await prisma.sport.findUnique({ where: { id: 'nfl' } });
    expect(sport).not.toBeNull();
  });

  it('survives a fetcher error', async () => {
    const fetchScoreboard = async () => {
      throw new Error('ESPN unavailable');
    };
    const result = await ingestSport('mlb', { prisma, log, fetchScoreboard });
    expect(result.fetched).toBe(0);
    expect(result.upserted).toBe(0);
  });
});
