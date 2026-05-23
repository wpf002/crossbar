export const SPORTS = ['mlb', 'nfl', 'nba', 'nhl'] as const;
export type SportId = (typeof SPORTS)[number];

export const MARKET_TYPES = ['MONEYLINE', 'TOTAL', 'SPREAD'] as const;
export const ORDER_SIDES = ['BUY', 'SELL'] as const;
export const OUTCOMES = ['YES', 'NO'] as const;

// Pricing: integer cents 1-99 per share
export const MIN_PRICE = 1;
export const MAX_PRICE = 99;
export const SHARE_PAYOUT = 100; // a winning share pays $1.00
