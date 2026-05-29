import { describe, it, expect } from 'vitest';
import pino from 'pino';
import type { Event } from '@prisma/client';
import { prisma } from '@crossbar/db';
import type { PlayerStatLine, SportEvent } from '@crossbar/shared';
import { ingestSport } from './ingest.js';
import { ingestPlayerStats } from './players.js';
import { applyEventTransitions } from './transitions.js';

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

async function seedEvent(opts: Partial<SportEvent>): Promise<Event> {
  const result = await ingestSport('mlb', {
    prisma,
    log,
    fetchScoreboard: async () => [evt(opts)],
  });
  return result.updatedEvents[0]!;
}

const STAT_LINES: PlayerStatLine[] = [
  { externalId: 'a1', name: 'Aaron Judge', team: 'Yankees', position: 'RF', stats: { hits: 2, RBIs: 3 } },
  { externalId: 'a2', name: 'Gerrit Cole', team: 'Yankees', position: 'SP', stats: { strikeouts: 8 } },
];

describe('ingestPlayerStats', () => {
  it('upserts players and stat lines, idempotently', async () => {
    const event = await seedEvent({ status: 'LIVE', homeScore: 1, awayScore: 0 });

    const r1 = await ingestPlayerStats(event, {
      prisma,
      log,
      fetchEventPlayerStats: async () => STAT_LINES,
    });
    expect(r1.players).toHaveLength(2);
    expect(await prisma.player.count()).toBe(2);
    expect(await prisma.playerStat.count()).toBe(2);

    // Second call updates in place — no duplicates.
    await ingestPlayerStats(event, {
      prisma,
      log,
      fetchEventPlayerStats: async () => STAT_LINES,
    });
    expect(await prisma.player.count()).toBe(2);
    expect(await prisma.playerStat.count()).toBe(2);

    const stat = await prisma.playerStat.findFirstOrThrow({
      where: { player: { externalId: 'a1' } },
    });
    expect(stat.stats).toMatchObject({ hits: 2, RBIs: 3 });
  });

  it('returns empty (no throw) when the box score fetch fails', async () => {
    const event = await seedEvent({ status: 'LIVE' });
    const r = await ingestPlayerStats(event, {
      prisma,
      log,
      fetchEventPlayerStats: async () => {
        throw new Error('boom');
      },
    });
    expect(r.players).toEqual([]);
    expect(await prisma.player.count()).toBe(0);
  });
});

describe('player-prop market resolution', () => {
  async function resolveWith(line: number, finalHits: number) {
    const event = await seedEvent({ status: 'LIVE', homeScore: 0, awayScore: 0 });
    const { players } = await ingestPlayerStats(event, {
      prisma,
      log,
      fetchEventPlayerStats: async () => STAT_LINES,
    });
    const judge = players.find((p) => p.line.externalId === 'a1')!;

    const market = await prisma.market.create({
      data: {
        eventId: event.id,
        type: 'PLAYER_TOTAL',
        playerId: judge.playerId,
        statKey: 'hits',
        line,
        question: `Will Aaron Judge record OVER ${line} hits?`,
        yesLabel: `Over ${line}`,
        noLabel: `Under ${line}`,
      },
    });

    // Game finishes; box score updates to the final hit total.
    const final = await ingestSport('mlb', {
      prisma,
      log,
      fetchScoreboard: async () => [evt({ status: 'FINAL', homeScore: 3, awayScore: 2 })],
    });
    const fevent = final.updatedEvents[0]!;
    await ingestPlayerStats(fevent, {
      prisma,
      log,
      fetchEventPlayerStats: async () => [
        { ...STAT_LINES[0]!, stats: { hits: finalHits, RBIs: 3 } },
        STAT_LINES[1]!,
      ],
    });
    await applyEventTransitions(fevent, { prisma, log });

    return prisma.market.findUniqueOrThrow({ where: { id: market.id } });
  }

  it('resolves YES when the final stat is over the line', async () => {
    const m = await resolveWith(1.5, 2);
    expect(m.status).toBe('RESOLVED');
    expect(m.outcome).toBe('YES');
  });

  it('resolves NO when the final stat is under the line', async () => {
    const m = await resolveWith(2.5, 2);
    expect(m.status).toBe('RESOLVED');
    expect(m.outcome).toBe('NO');
  });

  it('keeps both player props and game lines OPEN when the game goes LIVE', async () => {
    const event = await seedEvent({ status: 'LIVE', homeScore: 0, awayScore: 0 });
    const { players } = await ingestPlayerStats(event, {
      prisma,
      log,
      fetchEventPlayerStats: async () => STAT_LINES,
    });
    await prisma.market.create({
      data: {
        eventId: event.id,
        type: 'PLAYER_TOTAL',
        playerId: players[0]!.playerId,
        statKey: 'hits',
        line: 1.5,
        question: 'q',
        yesLabel: 'o',
        noLabel: 'u',
      },
    });

    await applyEventTransitions(event, { prisma, log });

    const prop = await prisma.market.findFirstOrThrow({ where: { type: 'PLAYER_TOTAL' } });
    expect(prop.status).toBe('OPEN');
    const gameLine = await prisma.market.findFirstOrThrow({ where: { type: 'MONEYLINE' } });
    expect(gameLine.status).toBe('OPEN');
  });
});
