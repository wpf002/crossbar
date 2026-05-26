import { clampCents } from '../fair-value.js';
import type { Bot, DesiredOrder, MarketContext } from '../types.js';

/**
 * Tier 2 — "Pinnacle"
 * Trusts ESPN. Attacks visible mispricings near fair, falls back to a passive
 * 2¢ band when the book is already at fair.
 */
export const pinnacle: Bot = {
  name: 'bot_pinnacle',
  decide(ctx: MarketContext): DesiredOrder[] {
    if (ctx.market.status !== 'OPEN') return [];
    if (ctx.fairConfidence === 'low') return [];
    const fair = ctx.fairYes;
    const yesBid = clampCents(fair - 2);
    const noBid = clampCents(100 - fair - 2);

    const yesAsk = ctx.market.topOfBook.yesAsk;
    const noAsk = ctx.market.topOfBook.noAsk;

    if (yesAsk != null && yesAsk <= fair - 1) {
      return [{ side: 'BUY', outcome: 'YES', price: yesAsk, quantity: 15 }];
    }
    if (noAsk != null && noAsk <= 100 - fair - 1) {
      return [{ side: 'BUY', outcome: 'NO', price: noAsk, quantity: 15 }];
    }
    return [
      { side: 'BUY', outcome: 'YES', price: yesBid, quantity: 10 },
      { side: 'BUY', outcome: 'NO', price: noBid, quantity: 10 },
    ];
  },
};
