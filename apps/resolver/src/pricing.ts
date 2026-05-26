import type { Market, Event } from '@prisma/client';

export type Outcome = 'YES' | 'NO' | 'INVALID';

/**
 * Pure outcome computation. No I/O. Returns INVALID for null scores
 * or push (tie at the line).
 */
export function computeOutcome(
  market: Pick<Market, 'type' | 'line'>,
  event: Pick<Event, 'homeScore' | 'awayScore'>,
): Outcome {
  const { homeScore, awayScore } = event;
  if (homeScore == null || awayScore == null) return 'INVALID';

  switch (market.type) {
    case 'MONEYLINE':
      if (homeScore > awayScore) return 'YES';
      if (homeScore < awayScore) return 'NO';
      return 'INVALID';

    case 'TOTAL': {
      if (market.line == null) return 'INVALID';
      const combined = homeScore + awayScore;
      if (combined > market.line) return 'YES';
      if (combined < market.line) return 'NO';
      return 'INVALID';
    }

    case 'SPREAD': {
      if (market.line == null) return 'INVALID';
      const diff = homeScore - awayScore;
      if (diff > market.line) return 'YES';
      if (diff < market.line) return 'NO';
      return 'INVALID';
    }

    default:
      return 'INVALID';
  }
}
