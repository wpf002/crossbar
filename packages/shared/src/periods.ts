import type { SportId } from './constants.js';

/**
 * Per-sport regulation period structure for in-game "period winner" markets.
 * `count` is how many regulation periods to open markets for; `noun` names a
 * period for question text. Overtime/extra innings beyond `count` aren't
 * auto-offered (they may not happen) but still resolve correctly if reached.
 */
export interface PeriodConfig {
  count: number;
  noun: string; // "quarter" | "period" | "inning"
}

export const PERIOD_CONFIG: Record<SportId, PeriodConfig> = {
  nfl: { count: 4, noun: 'quarter' },
  nba: { count: 4, noun: 'quarter' },
  nhl: { count: 3, noun: 'period' },
  mlb: { count: 9, noun: 'inning' },
};

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** e.g. "1st quarter", "3rd period", "7th inning". */
export function periodLabel(sport: SportId, n: number): string {
  return `${ordinal(n)} ${PERIOD_CONFIG[sport].noun}`;
}

export function periodWinnerQuestion(
  homeTeam: string,
  awayTeam: string,
  sport: SportId,
  period: number,
): string {
  return `Will the ${homeTeam} outscore the ${awayTeam} in the ${periodLabel(sport, period)}?`;
}
