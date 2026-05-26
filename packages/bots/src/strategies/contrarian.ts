import { clampCents } from '../fair-value.js';
import type { Bot, DesiredOrder, MarketContext } from '../types.js';

/**
 * Tier 2 — "Contrarian"
 * Fades recent YES-price direction. The thesis: markets overreact to fresh
 * information, so betting against the most-recent move is +EV.
 */
export const contrarian: Bot = {
  name: 'bot_contrarian',
  decide(ctx: MarketContext): DesiredOrder[] {
    if (ctx.market.status !== 'OPEN') return [];
    const trades = ctx.recentTrades.filter((t) => t.outcome === 'YES').slice(0, 5);
    if (trades.length < 2) return [];

    const oldest = trades[trades.length - 1]!.price;
    const newest = trades[0]!.price;
    const delta = newest - oldest;
    if (Math.abs(delta) < 3) return [];

    if (delta > 0) {
      return [{ side: 'BUY', outcome: 'NO', price: clampCents(100 - newest - 1), quantity: 20 }];
    }
    return [{ side: 'BUY', outcome: 'YES', price: clampCents(newest - 1), quantity: 20 }];
  },
};
