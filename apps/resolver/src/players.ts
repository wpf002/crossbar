import type { Event, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { PlayerStatLine, SportId } from '@crossbar/shared';
import { fetchEventPlayerStats as defaultFetch } from '@crossbar/sports';

export interface PlayerIngestDeps {
  prisma: PrismaClient;
  log: Logger;
  /** Injectable for tests. */
  fetchEventPlayerStats?: (
    sport: SportId,
    eventExternalId: string,
  ) => Promise<PlayerStatLine[]>;
}

export interface IngestedPlayer {
  playerId: string;
  line: PlayerStatLine;
}

export interface PlayerIngestResult {
  players: IngestedPlayer[];
}

/**
 * Fetch the box score for one event and upsert Player + PlayerStat rows.
 * Returns the ingested players (with their internal ids) so the caller can
 * auto-generate prop markets from who actually appeared. Safe to call
 * repeatedly during a live game — stats are upserted each tick.
 */
export async function ingestPlayerStats(
  event: Event,
  deps: PlayerIngestDeps,
): Promise<PlayerIngestResult> {
  const { prisma, log } = deps;
  const fetcher = deps.fetchEventPlayerStats ?? defaultFetch;
  const sport = event.sportId as SportId;

  let lines: PlayerStatLine[];
  try {
    lines = await fetcher(sport, event.externalId);
  } catch (err) {
    log.warn({ err, eventId: event.id }, 'fetchEventPlayerStats failed');
    return { players: [] };
  }

  const players: IngestedPlayer[] = [];
  for (const line of lines) {
    const player = await prisma.player.upsert({
      where: { sportId_externalId: { sportId: sport, externalId: line.externalId } },
      create: {
        sportId: sport,
        externalId: line.externalId,
        name: line.name,
        team: line.team,
        position: line.position ?? null,
      },
      update: {
        name: line.name,
        team: line.team,
        position: line.position ?? null,
      },
    });

    await prisma.playerStat.upsert({
      where: { eventId_playerId: { eventId: event.id, playerId: player.id } },
      create: { eventId: event.id, playerId: player.id, stats: line.stats },
      update: { stats: line.stats },
    });

    players.push({ playerId: player.id, line });
  }

  log.info({ eventId: event.id, players: players.length }, 'ingestPlayerStats complete');
  return { players };
}
