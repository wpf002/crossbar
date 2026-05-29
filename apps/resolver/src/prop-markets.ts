import type { Event, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { PROP_CATALOG, playerPropQuestion, type SportId } from '@crossbar/shared';
import type { IngestedPlayer } from './players.js';

export interface PropMarketDeps {
  prisma: PrismaClient;
  log: Logger;
}

/**
 * Auto-generate player-prop markets for the players who appeared in an event's
 * box score. A prop is created for each catalog stat the player actually
 * recorded (so QBs get passing-yard props, not rushing-only backs), deduped
 * against existing markets. Lines come from the catalog defaults — the order
 * book discovers the real probability. Gated by the caller; intended for LIVE
 * games so props open and trade during the game.
 */
export async function ensurePlayerPropMarkets(
  event: Event,
  players: IngestedPlayer[],
  deps: PropMarketDeps,
): Promise<number> {
  const sport = event.sportId as SportId;
  const catalog = PROP_CATALOG[sport] ?? [];
  if (catalog.length === 0 || players.length === 0) return 0;

  const existing = await deps.prisma.market.findMany({
    where: { eventId: event.id, type: 'PLAYER_TOTAL' },
    select: { playerId: true, statKey: true },
  });
  const seen = new Set(existing.map((m) => `${m.playerId}:${m.statKey}`));

  let created = 0;
  for (const { playerId, line } of players) {
    for (const prop of catalog) {
      if (!(prop.statKey in line.stats)) continue;
      const key = `${playerId}:${prop.statKey}`;
      if (seen.has(key)) continue;
      seen.add(key);

      await deps.prisma.market.create({
        data: {
          eventId: event.id,
          type: 'PLAYER_TOTAL',
          playerId,
          statKey: prop.statKey,
          line: prop.defaultLine,
          question: playerPropQuestion(line.name, prop.unit, prop.defaultLine),
          yesLabel: `Over ${prop.defaultLine}`,
          noLabel: `Under ${prop.defaultLine}`,
        },
      });
      created += 1;
    }
  }

  if (created > 0) {
    deps.log.info({ eventId: event.id, created }, 'created player prop markets');
  }
  return created;
}
