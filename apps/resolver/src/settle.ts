import type { Event, Market, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { resolveMarket } from '@crossbar/engine';
import { computeOutcome } from './pricing.js';

export interface SettleDeps {
  prisma: PrismaClient;
  log: Logger;
}

export async function resolveMarketFromEvent(
  market: Market,
  event: Event,
  deps: SettleDeps,
): Promise<void> {
  const outcome = computeOutcome(market, event);
  const result = await resolveMarket(deps.prisma, market.id, outcome);
  deps.log.info(
    {
      marketId: market.id,
      eventId: event.id,
      outcome,
      status: result.market.status,
      payouts: result.payouts.length,
    },
    'market settled',
  );
}
