import type { Event, Market } from '@prisma/client';

/** Inputs a bot strategy needs to make a decision for one market on one tick. */
export interface MarketContext {
  market: {
    id: string;
    type: 'MONEYLINE' | 'TOTAL' | 'SPREAD';
    line: number | null;
    status: 'OPEN' | 'CLOSED' | 'RESOLVED' | 'VOIDED';
    topOfBook: {
      yesBid: number | null;
      yesAsk: number | null;
      noBid: number | null;
      noAsk: number | null;
    };
    lastTradePrice: number | null;
  };
  event: Pick<
    Event,
    | 'id'
    | 'sportId'
    | 'startsAt'
    | 'status'
    | 'spread'
    | 'overUnder'
    | 'homeMoneyLine'
    | 'awayMoneyLine'
    | 'homeTeam'
    | 'awayTeam'
  >;
  recentTrades: Array<{ outcome: 'YES' | 'NO'; price: number; quantity: number; createdAt: string }>;
  /** Current fair YES price in cents (2-98). */
  fairYes: number;
  fairConfidence: 'high' | 'med' | 'low';
}

export interface DesiredOrder {
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: number;
  quantity: number;
}

export interface Bot {
  name: string;
  decide(ctx: MarketContext): DesiredOrder[];
}

export type MarketType = Market['type'];
