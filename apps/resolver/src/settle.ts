import type { Event, Market, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { resolveMarket } from '@crossbar/engine';
import { computeOutcome, computePlayerOutcome, type Outcome } from './pricing.js';

export interface SettleDeps {
  prisma: PrismaClient;
  log: Logger;
}

export async function resolveMarketFromEvent(
  market: Market,
  event: Event,
  deps: SettleDeps,
): Promise<void> {
  const outcome =
    market.type === 'PLAYER_TOTAL'
      ? await computePlayerMarketOutcome(market, event, deps.prisma)
      : computeOutcome(market, event);

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

/**
 * Resolve a player-prop market from its stored stat line. INVALID if the
 * market is missing its player/stat binding or the player never recorded the
 * stat (treated as a no-show → settled as a push to refund both sides).
 */
async function computePlayerMarketOutcome(
  market: Market,
  event: Event,
  prisma: PrismaClient,
): Promise<Outcome> {
  if (!market.playerId || !market.statKey) return 'INVALID';

  const ps = await prisma.playerStat.findUnique({
    where: { eventId_playerId: { eventId: event.id, playerId: market.playerId } },
  });
  const stats = (ps?.stats ?? {}) as Record<string, unknown>;
  const raw = stats[market.statKey];
  const value = typeof raw === 'number' ? raw : null;

  return computePlayerOutcome(market.line, value);
}
