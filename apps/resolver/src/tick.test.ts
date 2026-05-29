import { describe, it, expect } from 'vitest';
import type { EventStatus } from '@prisma/client';
import { prisma } from '@crossbar/db';
import { liveSports } from './tick.js';

async function mkEvent(sportId: string, externalId: string, status: EventStatus) {
  await prisma.sport.upsert({
    where: { id: sportId },
    update: {},
    create: { id: sportId, name: sportId.toUpperCase() },
  });
  return prisma.event.create({
    data: { sportId, externalId, homeTeam: 'H', awayTeam: 'A', startsAt: new Date(), status },
  });
}

describe('liveSports', () => {
  it('returns distinct sports that have a LIVE event', async () => {
    await mkEvent('mlb', 'm1', 'LIVE');
    await mkEvent('mlb', 'm2', 'LIVE');
    await mkEvent('nba', 'n1', 'LIVE');
    await mkEvent('nfl', 'f1', 'SCHEDULED');

    const sports = await liveSports(prisma);
    expect([...sports].sort()).toEqual(['mlb', 'nba']);
  });

  it('returns empty when nothing is live', async () => {
    await mkEvent('nhl', 'h1', 'FINAL');
    await mkEvent('nfl', 'f2', 'SCHEDULED');
    expect(await liveSports(prisma)).toEqual([]);
  });
});
