import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { SportId } from '@crossbar/shared';
import { ingestSport } from './ingest.js';
import { ingestPlayerStats } from './players.js';
import { ensurePlayerPropMarkets } from './prop-markets.js';
import { applyEventTransitions } from './transitions.js';

export interface TickDeps {
  prisma: PrismaClient;
  log: Logger;
  /** Auto-generate player-prop markets from live box scores. */
  autogenProps?: boolean;
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
      // Pull box-score stats for in-progress/finished games before running
      // transitions, so FINAL player-prop resolution reads the final line.
      if (event.status === 'LIVE' || event.status === 'FINAL') {
        const { players } = await ingestPlayerStats(event, { prisma, log });
        if (deps.autogenProps && event.status === 'LIVE') {
          await ensurePlayerPropMarkets(event, players, { prisma, log });
        }
      }
      await applyEventTransitions(event, { prisma, log });
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
