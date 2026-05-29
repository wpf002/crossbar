import type { Event, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { EventSummary, SportId } from '@crossbar/shared';
import { fetchEventSummary as defaultFetch } from '@crossbar/sports';
import { applyEventTransitions } from './transitions.js';

export interface ReconcileDeps {
  prisma: PrismaClient;
  log: Logger;
  fetchEventSummary?: (sport: SportId, eventExternalId: string) => Promise<EventSummary>;
  /** Override "now" for tests. */
  now?: number;
}

// A game still LIVE this long after it dropped off the scoreboard is certainly
// over; finalize from last-known scores if the summary can't be fetched.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Finalize LIVE events that are no longer in the scoreboard feed. ESPN drops
 * finished games from the scoreboard, so the normal ingest loop never
 * transitions them and they get stuck LIVE forever. For each such orphan, pull
 * the summary to recover the final score/linescores; if that fails and the game
 * is clearly over, finalize from last-known scores. Then run transitions so its
 * markets settle.
 */
export async function reconcileMissingLive(
  sport: SportId,
  seenExternalIds: Set<string>,
  deps: ReconcileDeps,
): Promise<number> {
  const { prisma, log } = deps;
  const fetcher = deps.fetchEventSummary ?? defaultFetch;
  const now = deps.now ?? Date.now();

  const orphans = await prisma.event.findMany({
    where: { sportId: sport, status: 'LIVE', externalId: { notIn: [...seenExternalIds] } },
  });
  if (orphans.length === 0) return 0;

  let finalized = 0;
  for (const orphan of orphans) {
    try {
      const updated = await finalizeOrphan(orphan, fetcher, now, deps);
      if (updated) {
        await applyEventTransitions(updated, deps);
        finalized += 1;
        log.info(
          { eventId: orphan.id, sport, externalId: orphan.externalId },
          'finalized orphaned LIVE event',
        );
      }
    } catch (err) {
      log.error({ err, eventId: orphan.id }, 'reconcile failed');
    }
  }
  return finalized;
}

async function finalizeOrphan(
  orphan: Event,
  fetcher: (sport: SportId, id: string) => Promise<EventSummary>,
  now: number,
  deps: ReconcileDeps,
): Promise<Event | null> {
  const sport = orphan.sportId as SportId;

  // Preferred: recover the real final result from the summary.
  try {
    const { game } = await fetcher(sport, orphan.externalId);
    const terminal = game.status === 'FINAL' || game.status === 'POSTPONED' || game.status === 'CANCELED';
    if (terminal || game.homeScore != null) {
      return deps.prisma.event.update({
        where: { id: orphan.id },
        data: {
          status: game.status === 'POSTPONED' || game.status === 'CANCELED' ? game.status : 'FINAL',
          homeScore: game.homeScore ?? orphan.homeScore,
          awayScore: game.awayScore ?? orphan.awayScore,
          period: game.period ?? orphan.period,
          homeLinescores: game.homeLinescores ?? orphan.homeLinescores,
          awayLinescores: game.awayLinescores ?? orphan.awayLinescores,
        },
      });
    }
  } catch (err) {
    deps.log.warn({ err, eventId: orphan.id }, 'orphan summary fetch failed');
  }

  // Fallback: the game is long past and we can't fetch it — finalize from the
  // last-known score so its markets don't hang open indefinitely.
  if (now - orphan.startsAt.getTime() > STALE_AFTER_MS && orphan.homeScore != null) {
    return deps.prisma.event.update({
      where: { id: orphan.id },
      data: { status: 'FINAL' },
    });
  }

  return null;
}
