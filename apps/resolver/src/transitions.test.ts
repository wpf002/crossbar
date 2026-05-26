import { describe, it, expect } from 'vitest';
import pino from 'pino';
import type { Event } from '@prisma/client';
import { prisma } from '@crossbar/db';
import type { SportEvent } from '@crossbar/shared';
import { ingestSport } from './ingest.js';
import { applyEventTransitions } from './transitions.js';

const log = pino({ level: 'silent' });

function baseEvt(overrides: Partial<SportEvent> = {}): SportEvent {
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

async function seedSingleMarketEvent(opts: {
  status: SportEvent['status'];
  homeScore?: number;
  awayScore?: number;
  overUnder?: number;
  spread?: number;
}): Promise<Event> {
  const result = await ingestSport('mlb', {
    prisma,
    log,
    fetchScoreboard: async () => [baseEvt(opts)],
  });
  return result.updatedEvents[0]!;
}

describe('applyEventTransitions', () => {
  it('closes markets when event goes LIVE', async () => {
    const event = await seedSingleMarketEvent({ status: 'LIVE' });

    await applyEventTransitions(event, { prisma, log });

    const market = await prisma.market.findFirstOrThrow();
    expect(market.status).toBe('CLOSED');
    expect(market.closedAt).not.toBeNull();
  });

  it('resolves MONEYLINE markets correctly when event is FINAL', async () => {
    const event = await seedSingleMarketEvent({
      status: 'FINAL',
      homeScore: 7,
      awayScore: 3,
    });

    await applyEventTransitions(event, { prisma, log });

    const market = await prisma.market.findFirstOrThrow();
    expect(market.status).toBe('RESOLVED');
    expect(market.outcome).toBe('YES');
  });

  it('resolves TOTAL markets using the line', async () => {
    const event = await seedSingleMarketEvent({
      status: 'FINAL',
      homeScore: 5,
      awayScore: 4,
      overUnder: 8.5,
    });

    await applyEventTransitions(event, { prisma, log });

    const total = await prisma.market.findFirstOrThrow({ where: { type: 'TOTAL' } });
    expect(total.status).toBe('RESOLVED');
    expect(total.outcome).toBe('YES');
  });

  it('voids markets when event is POSTPONED', async () => {
    const event = await seedSingleMarketEvent({ status: 'POSTPONED' });

    await applyEventTransitions(event, { prisma, log });

    const market = await prisma.market.findFirstOrThrow();
    expect(market.status).toBe('VOIDED');
    expect(market.outcome).toBe('INVALID');
  });

  it('voids markets when event is CANCELED', async () => {
    const event = await seedSingleMarketEvent({ status: 'CANCELED' });

    await applyEventTransitions(event, { prisma, log });

    const market = await prisma.market.findFirstOrThrow();
    expect(market.status).toBe('VOIDED');
  });

  it('is idempotent on repeat — second call on FINAL event does not re-resolve', async () => {
    const event = await seedSingleMarketEvent({
      status: 'FINAL',
      homeScore: 4,
      awayScore: 2,
    });

    await applyEventTransitions(event, { prisma, log });
    const first = await prisma.market.findFirstOrThrow();

    await applyEventTransitions(event, { prisma, log });
    const second = await prisma.market.findFirstOrThrow();

    expect(second.status).toBe('RESOLVED');
    expect(second.resolvedAt?.getTime()).toBe(first.resolvedAt?.getTime());
  });

  it('LIVE then FINAL — closes then resolves', async () => {
    let event = await seedSingleMarketEvent({ status: 'LIVE' });
    await applyEventTransitions(event, { prisma, log });

    let market = await prisma.market.findFirstOrThrow();
    expect(market.status).toBe('CLOSED');

    // Re-ingest with FINAL status.
    const result = await ingestSport('mlb', {
      prisma,
      log,
      fetchScoreboard: async () => [
        baseEvt({ status: 'FINAL', homeScore: 6, awayScore: 4 }),
      ],
    });
    event = result.updatedEvents[0]!;
    await applyEventTransitions(event, { prisma, log });

    market = await prisma.market.findFirstOrThrow();
    expect(market.status).toBe('RESOLVED');
    expect(market.outcome).toBe('YES');
  });
});
