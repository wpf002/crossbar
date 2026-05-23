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

export interface SportEvent {
  externalId: string;
  sportId: SportId;
  homeTeam: string;
  awayTeam: string;
  startsAt: string; // ISO
  status: 'SCHEDULED' | 'LIVE' | 'FINAL' | 'POSTPONED' | 'CANCELED';
  homeScore?: number;
  awayScore?: number;
}
