import { describe, it, expect } from 'vitest';
import { prisma } from '@crossbar/db';
import { createMarket } from './markets.js';

async function seedEventAndPlayer() {
  await prisma.sport.upsert({ where: { id: 'nfl' }, update: {}, create: { id: 'nfl', name: 'NFL' } });
  const event = await prisma.event.create({
    data: {
      sportId: 'nfl',
      externalId: `evt-${Date.now()}-${Math.random()}`,
      homeTeam: 'Bills',
      awayTeam: 'Jets',
      startsAt: new Date(Date.now() + 3_600_000),
    },
  });
  const player = await prisma.player.create({
    data: { sportId: 'nfl', externalId: `ath-${Date.now()}`, name: 'Josh Allen', team: 'Bills', position: 'QB' },
  });
  return { event, player };
}

describe('createMarket — PLAYER_TOTAL', () => {
  it('creates a player prop with catalog-derived question', async () => {
    const { event, player } = await seedEventAndPlayer();
    const market = await createMarket(prisma, {
      eventId: event.id,
      type: 'PLAYER_TOTAL',
      playerId: player.id,
      statKey: 'passingYards',
      line: 274.5,
    });

    expect(market.type).toBe('PLAYER_TOTAL');
    expect(market.playerId).toBe(player.id);
    expect(market.statKey).toBe('passingYards');
    expect(market.line).toBe(274.5);
    expect(market.question).toBe('Will Josh Allen record OVER 274.5 passing yards?');
    expect(market.yesLabel).toBe('Over 274.5');
  });

  it('rejects when playerId/statKey missing', async () => {
    const { event } = await seedEventAndPlayer();
    await expect(
      createMarket(prisma, { eventId: event.id, type: 'PLAYER_TOTAL', line: 1.5 }),
    ).rejects.toThrow(/playerId and statKey/);
  });

  it('rejects when player belongs to a different sport', async () => {
    const { event } = await seedEventAndPlayer();
    await prisma.sport.upsert({ where: { id: 'nba' }, update: {}, create: { id: 'nba', name: 'NBA' } });
    const other = await prisma.player.create({
      data: { sportId: 'nba', externalId: `x-${Date.now()}`, name: 'X', team: 'Y' },
    });
    await expect(
      createMarket(prisma, {
        eventId: event.id,
        type: 'PLAYER_TOTAL',
        playerId: other.id,
        statKey: 'points',
        line: 20.5,
      }),
    ).rejects.toThrow(/different sports/);
  });

  it('still requires a numeric line', async () => {
    const { event, player } = await seedEventAndPlayer();
    await expect(
      createMarket(prisma, {
        eventId: event.id,
        type: 'PLAYER_TOTAL',
        playerId: player.id,
        statKey: 'passingYards',
      }),
    ).rejects.toThrow(/requires a numeric line/);
  });
});
