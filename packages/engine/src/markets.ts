import type { Event, Market, PrismaClient } from '@prisma/client';
import { playerPropQuestion, propDef, type SportId } from '@crossbar/shared';

export interface CreateMarketInput {
  eventId: string;
  type: 'MONEYLINE' | 'TOTAL' | 'SPREAD' | 'PLAYER_TOTAL';
  line?: number | null;
  /** PLAYER_TOTAL only: the player and stat the line is on. */
  playerId?: string;
  statKey?: string;
  /** Override the auto-generated question text. */
  question?: string;
  yesLabel?: string;
  noLabel?: string;
}

/**
 * Create a single market for an event. Used by:
 *   - the resolver, which auto-generates markets from ESPN ingest
 *   - the admin endpoint, which lets staff create custom markets manually
 *
 * Validates that the event exists and that TOTAL/SPREAD markets carry a line.
 */
export async function createMarket(
  prisma: PrismaClient,
  input: CreateMarketInput,
): Promise<Market> {
  const event = await prisma.event.findUnique({ where: { id: input.eventId } });
  if (!event) {
    throw new Error(`Event ${input.eventId} not found`);
  }
  if (input.type !== 'MONEYLINE' && (input.line == null || Number.isNaN(input.line))) {
    throw new Error(`Market type ${input.type} requires a numeric line`);
  }

  if (input.type === 'PLAYER_TOTAL') {
    return createPlayerMarket(prisma, event, input);
  }

  const { question, yesLabel, noLabel } = labelsFor(event, input);
  return prisma.market.create({
    data: {
      eventId: input.eventId,
      type: input.type,
      line: input.type === 'MONEYLINE' ? null : input.line!,
      question,
      yesLabel,
      noLabel,
    },
  });
}

async function createPlayerMarket(
  prisma: PrismaClient,
  event: Event,
  input: CreateMarketInput,
): Promise<Market> {
  if (!input.playerId || !input.statKey) {
    throw new Error('PLAYER_TOTAL markets require playerId and statKey');
  }
  const player = await prisma.player.findUnique({ where: { id: input.playerId } });
  if (!player) {
    throw new Error(`Player ${input.playerId} not found`);
  }
  if (player.sportId !== event.sportId) {
    throw new Error('Player and event belong to different sports');
  }

  const line = input.line!;
  const unit = propDef(event.sportId as SportId, input.statKey)?.unit ?? input.statKey;
  return prisma.market.create({
    data: {
      eventId: event.id,
      type: 'PLAYER_TOTAL',
      playerId: player.id,
      statKey: input.statKey,
      line,
      question: input.question ?? playerPropQuestion(player.name, unit, line),
      yesLabel: input.yesLabel ?? `Over ${line}`,
      noLabel: input.noLabel ?? `Under ${line}`,
    },
  });
}

/**
 * Default labels for a market. Callers can override any field via the input.
 */
function labelsFor(
  event: Event,
  input: CreateMarketInput,
): { question: string; yesLabel: string; noLabel: string } {
  if (input.type === 'MONEYLINE') {
    return {
      question:
        input.question ?? `Will the ${event.homeTeam} beat the ${event.awayTeam}?`,
      yesLabel: input.yesLabel ?? `${event.homeTeam} wins`,
      noLabel: input.noLabel ?? `${event.awayTeam} wins`,
    };
  }
  if (input.type === 'TOTAL') {
    return {
      question:
        input.question ?? `Will combined score go OVER ${input.line}?`,
      yesLabel: input.yesLabel ?? `Over ${input.line}`,
      noLabel: input.noLabel ?? `Under ${input.line}`,
    };
  }
  // SPREAD
  const line = input.line!;
  return {
    question:
      input.question ?? `Will ${event.homeTeam} cover ${formatSigned(line)}?`,
    yesLabel: input.yesLabel ?? `${event.homeTeam} ${formatSigned(line)}`,
    noLabel: input.noLabel ?? `${event.awayTeam} ${formatSigned(-line)}`,
  };
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
