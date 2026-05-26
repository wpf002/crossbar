import { clampCents } from '../fair-value.js';
import type { Bot, DesiredOrder, MarketContext } from '../types.js';

const SPREAD_CENTS = 3;
const QTY = 25;

/**
 * Tier 1 — symmetric pair of BUYs around fair value.
 * Posts BUY YES @ (fair-3) and BUY NO @ (100-fair-3). When real users converge
 * on the implicit YES bid/ask, cross-trades mint share pairs and the bot books
 * the 6¢ spread.
 */
export const houseMaker: Bot = {
  name: 'bot_house',
  decide(ctx: MarketContext): DesiredOrder[] {
    if (ctx.market.status !== 'OPEN') return [];
    const yesPrice = clampCents(ctx.fairYes - SPREAD_CENTS);
    const noPrice = clampCents(100 - ctx.fairYes - SPREAD_CENTS);
    return [
      { side: 'BUY', outcome: 'YES', price: yesPrice, quantity: QTY },
      { side: 'BUY', outcome: 'NO', price: noPrice, quantity: QTY },
    ];
  },
};
