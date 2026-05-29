import type { Event, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { EventSummary, SportId } from '@crossbar/shared';
import { fetchEventSummary as defaultFetch } from '@crossbar/sports';

export interface PlayerIngestDeps {
  prisma: PrismaClient;
  log: Logger;
  /** Injectable for tests. */
  fetchEventSummary?: (sport: SportId, eventExternalId: string) => Promise<EventSummary>;
}

export interface IngestedPlayer {
  playerId: string;
  line: EventSummary['players'][number];
}

export interface PlayerIngestResult {
  /** The event with its live game state refreshed from the summary. */
  event: Event;
  players: IngestedPlayer[];
}

/**
 * Fetch the event summary and (a) refresh the event's live game state —
 * score, period, clock, and per-period linescores (the scoreboard omits
 * linescores for MLB, so this is what makes per-inning resolution work) — and
 * (b) upsert Player + PlayerStat rows. Returns the refreshed event so callers
 * resolve markets against current state. Safe to call every live tick.
 */
export async function ingestPlayerStats(
  event: Event,
  deps: PlayerIngestDeps,
): Promise<PlayerIngestResult> {
  const { prisma, log } = deps;
  const fetcher = deps.fetchEventSummary ?? defaultFetch;
  const sport = event.sportId as SportId;

  let summary: EventSummary;
  try {
    summary = await fetcher(sport, event.externalId);
  } catch (err) {
    log.warn({ err, eventId: event.id }, 'fetchEventSummary failed');
    return { event, players: [] };
  }

  const players: IngestedPlayer[] = [];
  for (const line of summary.players) {
    const player = await prisma.player.upsert({
      where: { sportId_externalId: { sportId: sport, externalId: line.externalId } },
      create: {
        sportId: sport,
        externalId: line.externalId,
        name: line.name,
        team: line.team,
        position: line.position ?? null,
      },
      update: { name: line.name, team: line.team, position: line.position ?? null },
    });

    await prisma.playerStat.upsert({
      where: { eventId_playerId: { eventId: event.id, playerId: player.id } },
      create: { eventId: event.id, playerId: player.id, stats: line.stats },
      update: { stats: line.stats },
    });

    players.push({ playerId: player.id, line });
  }

  // Refresh live game state. Only overwrite fields the summary actually carries
  // (don't clobber good scoreboard data with gaps).
  const g = summary.game;
  const data: Record<string, unknown> = {};
  if (g.homeScore != null) data.homeScore = g.homeScore;
  if (g.awayScore != null) data.awayScore = g.awayScore;
  if (g.period != null) data.period = g.period;
  if (g.displayClock != null) data.displayClock = g.displayClock;
  if (g.homeLinescores) data.homeLinescores = g.homeLinescores;
  if (g.awayLinescores) data.awayLinescores = g.awayLinescores;

  const refreshed =
    Object.keys(data).length > 0
      ? await prisma.event.update({ where: { id: event.id }, data })
      : event;

  log.info({ eventId: event.id, players: players.length }, 'ingestPlayerStats complete');
  return { event: refreshed, players };
}
