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

/**
 * Player-prop outcome: did the player go OVER the line on the tracked stat?
 * Pure, no I/O. INVALID for a missing line, missing stat, or exact push.
 */
export function computePlayerOutcome(
  line: number | null,
  statValue: number | null | undefined,
): Outcome {
  if (line == null) return 'INVALID';
  if (statValue == null || Number.isNaN(statValue)) return 'INVALID';
  if (statValue > line) return 'YES';
  if (statValue < line) return 'NO';
  return 'INVALID';
}

/**
 * Period-winner outcome: did home outscore away in the given period? Pure.
 * YES if home's period score > away's, NO if less, INVALID for a tie (push) or
 * a period with no recorded scores on either side (never played → refund).
 */
export function computePeriodOutcome(
  homeLinescores: number[],
  awayLinescores: number[],
  period: number,
): Outcome {
  const idx = period - 1;
  if (idx < 0) return 'INVALID';
  const home = homeLinescores[idx];
  const away = awayLinescores[idx];
  if (home == null || away == null) return 'INVALID';
  if (home > away) return 'YES';
  if (home < away) return 'NO';
  return 'INVALID';
}
