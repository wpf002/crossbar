import type { Event, Market } from '@prisma/client';

/**
 * Convert American moneyline odds to implied probability.
 *   -150 → 0.60  (favorite, more risk for the same payout)
 *   +130 → 0.4348 (underdog)
 */
export function americanToProb(odds: number): number {
  if (odds === 0) return 0.5;
  if (odds < 0) return -odds / (-odds + 100);
  return 100 / (odds + 100);
}

/**
 * Given two moneylines (home + away), strip the vig and return the normalized
 * home-win probability. ESPN's moneylines typically have ~5% vig built in.
 */
export function deVigMoneyline(homeML: number, awayML: number): number {
  const home = americanToProb(homeML);
  const away = americanToProb(awayML);
  const total = home + away;
  if (total <= 0) return 0.5;
  return home / total;
}

/**
 * Convert a point spread to an implied home-win probability using a sport-
 * specific logistic. spread < 0 means home is favored.
 */
export function spreadToHomeProb(spread: number, sportId: string): number {
  const k: Record<string, number> = {
    nfl: 4.5,
    nba: 5.5,
    mlb: 1.3,
    nhl: 1.5,
  };
  const scale = k[sportId] ?? 4;
  return 1 / (1 + Math.exp(spread / scale));
}

export interface FairValue {
  yesCents: number;
  confidence: 'high' | 'med' | 'low';
  source: string;
}

export function fairValueFor(
  market: Pick<Market, 'type' | 'line'>,
  event: Pick<Event, 'sportId' | 'spread' | 'overUnder' | 'homeMoneyLine' | 'awayMoneyLine'>,
): FairValue {
  if (market.type === 'MONEYLINE') {
    if (event.homeMoneyLine != null && event.awayMoneyLine != null) {
      const prob = deVigMoneyline(event.homeMoneyLine, event.awayMoneyLine);
      return {
        yesCents: clampCents(prob * 100),
        confidence: 'high',
        source: `de-vigged moneyline (${event.homeMoneyLine}/${event.awayMoneyLine})`,
      };
    }
    if (event.spread != null) {
      const prob = spreadToHomeProb(event.spread, event.sportId);
      return {
        yesCents: clampCents(prob * 100),
        confidence: 'med',
        source: `spread ${event.spread} via ${event.sportId} logistic`,
      };
    }
    return { yesCents: 50, confidence: 'low', source: 'default 50¢' };
  }
  if (market.type === 'TOTAL' || market.type === 'SPREAD') {
    return { yesCents: 50, confidence: 'med', source: `${market.type} line built ~50/50` };
  }
  return { yesCents: 50, confidence: 'low', source: 'unknown market type' };
}

export function clampCents(v: number): number {
  return Math.max(2, Math.min(98, Math.round(v)));
}
