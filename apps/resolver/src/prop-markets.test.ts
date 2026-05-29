import { describe, it, expect } from 'vitest';
import pino from 'pino';
import type { Event } from '@prisma/client';
import { prisma } from '@crossbar/db';
import type { PlayerStatLine, SportEvent } from '@crossbar/shared';
import { ingestSport } from './ingest.js';
import { ingestPlayerStats } from './players.js';
import { ensurePlayerPropMarkets } from './prop-markets.js';

const log = pino({ level: 'silent' });

function evt(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    externalId: 'espn-1',
    sportId: 'mlb',
    homeTeam: 'Yankees',
    awayTeam: 'Red Sox',
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'LIVE',
    ...overrides,
  };
}

async function seedLiveEventWithPlayers(lines: PlayerStatLine[]): Promise<Event> {
  const result = await ingestSport('mlb', {
    prisma,
    log,
    fetchScoreboard: async () => [evt()],
  });
  const event = result.updatedEvents[0]!;
  await ingestPlayerStats(event, {
    prisma,
    log,
    fetchEventSummary: async () => ({ game: {}, players: lines }),
  });
  return event;
}

const LINES: PlayerStatLine[] = [
  { externalId: 'a1', name: 'Aaron Judge', team: 'Yankees', position: 'RF', stats: { hits: 2, RBIs: 3 } },
  { externalId: 'a2', name: 'Gerrit Cole', team: 'Yankees', position: 'SP', stats: { strikeouts: 8 } },
];

describe('ensurePlayerPropMarkets', () => {
  it('creates one prop per catalog stat the player recorded', async () => {
    const event = await seedLiveEventWithPlayers(LINES);
    const players = (await prisma.player.findMany()).map((p) => ({
      playerId: p.id,
      line: LINES.find((l) => l.externalId === p.externalId)!,
    }));

    const created = await ensurePlayerPropMarkets(event, players, { prisma, log });

    // Judge: hits + RBIs (2); Cole: strikeouts (1) → 3 total.
    expect(created).toBe(3);
    const props = await prisma.market.findMany({ where: { type: 'PLAYER_TOTAL' } });
    expect(props).toHaveLength(3);
    const judgeHits = props.find((m) => m.statKey === 'hits')!;
    expect(judgeHits.line).toBe(0.5); // catalog default for mlb hits
    expect(judgeHits.question).toContain('Aaron Judge');
  });

  it('is idempotent — a second pass creates nothing new', async () => {
    const event = await seedLiveEventWithPlayers(LINES);
    const players = (await prisma.player.findMany()).map((p) => ({
      playerId: p.id,
      line: LINES.find((l) => l.externalId === p.externalId)!,
    }));

    expect(await ensurePlayerPropMarkets(event, players, { prisma, log })).toBe(3);
    expect(await ensurePlayerPropMarkets(event, players, { prisma, log })).toBe(0);
    expect(await prisma.market.count({ where: { type: 'PLAYER_TOTAL' } })).toBe(3);
  });
});
