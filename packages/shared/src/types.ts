import type { SportId } from './constants.js';

export interface PlaceOrderRequest {
  marketId: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: number;   // 1-99
  quantity: number; // shares
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  marketId: string;
  yesBids: OrderBookLevel[]; // descending by price
  yesAsks: OrderBookLevel[]; // ascending by price
  noBids: OrderBookLevel[];
  noAsks: OrderBookLevel[];
  lastTradePrice?: number;
  lastTradeAt?: string;
}

/**
 * A single player's normalized stat line for one game, extracted from the
 * ESPN box score. `stats` keys match ESPN's camelCase stat keys (e.g.
 * "rushingYards", "points") — the same keys the prop catalog references.
 */
export interface PlayerStatLine {
  externalId: string; // ESPN athlete id
  name: string;
  team: string; // team display name
  position?: string;
  stats: Record<string, number>;
}

export interface SportEvent {
  externalId: string;
  sportId: SportId;
  homeTeam: string;
  awayTeam: string;
  startsAt: string; // ISO
  status: 'SCHEDULED' | 'LIVE' | 'FINAL' | 'POSTPONED' | 'CANCELED';
  homeScore?: number;
  awayScore?: number;
  /** Spread: negative = home favored (e.g. home -3.5 means -3.5). */
  spread?: number;
  /** Combined points/runs/goals line for OVER/UNDER. */
  overUnder?: number;
  /** American moneyline odds, e.g. -150 (favorite) or +130 (underdog). */
  homeMoneyLine?: number;
  awayMoneyLine?: number;
}
