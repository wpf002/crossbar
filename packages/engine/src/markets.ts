import type { Event, Market, PrismaClient } from '@prisma/client';

export interface CreateMarketInput {
  eventId: string;
  type: 'MONEYLINE' | 'TOTAL' | 'SPREAD';
  line?: number | null;
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
