import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { SportId } from '@crossbar/shared';
import { ingestSport } from './ingest.js';
import { ingestPlayerStats } from './players.js';
import { ensurePlayerPropMarkets } from './prop-markets.js';
import { ensurePeriodMarkets } from './period-markets.js';
import { reconcileMissingLive } from './reconcile.js';
import { applyEventTransitions } from './transitions.js';

export interface TickDeps {
  prisma: PrismaClient;
  log: Logger;
  /** Auto-generate player-prop markets from live box scores. */
  autogenProps?: boolean;
  /** Auto-generate per-period winner markets for live games. */
  periodMarkets?: boolean;
}

/**
 * Ingest the given sports, refresh player stats + live state, and run market
 * transitions. Shared by the slow full poll (all sports) and the fast live
 * poll (only sports with a game in progress).
 */
export async function runTick(sports: readonly SportId[], deps: TickDeps): Promise<void> {
  const { prisma, log } = deps;
  for (const sport of sports) {
    const result = await ingestSport(sport, { prisma, log });
    for (const event of result.updatedEvents) {
      let current = event;
      // Pull the summary for in-progress/finished games before running
      // transitions: it refreshes live state (incl. linescores) and player
      // stats, so period and player-prop markets resolve against current data.
      if (current.status === 'LIVE' || current.status === 'FINAL') {
        const r = await ingestPlayerStats(current, { prisma, log });
        current = r.event;
        if (deps.autogenProps && current.status === 'LIVE') {
          await ensurePlayerPropMarkets(current, r.players, { prisma, log });
        }
      }
      if (deps.periodMarkets && current.status === 'LIVE') {
        await ensurePeriodMarkets(current, { prisma, log });
      }
      await applyEventTransitions(current, { prisma, log });
    }

    // Finalize any LIVE events that fell off the scoreboard (ESPN drops
    // finished games), so they don't hang open forever. Only when the fetch
    // succeeded — an empty fetch must not orphan everything.
    if (result.fetched > 0) {
      const seen = new Set(result.updatedEvents.map((e) => e.externalId));
      await reconcileMissingLive(sport, seen, { prisma, log });
    }
  }
}

/** Distinct sports that currently have at least one LIVE event. */
export async function liveSports(prisma: PrismaClient): Promise<SportId[]> {
  const rows = await prisma.event.findMany({
    where: { status: 'LIVE' },
    select: { sportId: true },
    distinct: ['sportId'],
  });
  return rows.map((r) => r.sportId as SportId);
}
