import type { Event, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { voidMarket } from '@crossbar/engine';
import { resolveMarketFromEvent } from './settle.js';

export interface TransitionsDeps {
  prisma: PrismaClient;
  log: Logger;
}

/**
 * Apply the event's current status to all of its markets. All transitions
 * are idempotent — repeated calls on already-terminal markets no-op.
 */
export async function applyEventTransitions(
  event: Event,
  deps: TransitionsDeps,
): Promise<void> {
  const { prisma, log } = deps;
  const markets = await prisma.market.findMany({ where: { eventId: event.id } });

  for (const market of markets) {
    try {
      if (event.status === 'LIVE') {
        // Live in-game markets: game lines and player props both stay OPEN and
        // trade through the game. The order book reprices off the live score;
        // everything settles at FINAL. (Nothing to do on the LIVE transition.)
      } else if (event.status === 'FINAL') {
        if (market.status === 'RESOLVED' || market.status === 'VOIDED') continue;
        await resolveMarketFromEvent(market, event, deps);
      } else if (event.status === 'POSTPONED' || event.status === 'CANCELED') {
        if (market.status === 'RESOLVED' || market.status === 'VOIDED') continue;
        await voidMarket(prisma, market.id, event.status);
        log.info(
          { marketId: market.id, eventId: event.id, reason: event.status },
          'voided market',
        );
      }
    } catch (err) {
      log.error(
        { err, marketId: market.id, eventId: event.id, eventStatus: event.status },
        'transition failed',
      );
    }
  }
}
