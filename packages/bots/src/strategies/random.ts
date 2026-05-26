import { clampCents } from '../fair-value.js';
import type { Bot, DesiredOrder, MarketContext } from '../types.js';

/**
 * Tier 2 — "Random"
 * Posts small random orders near fair. Noise floor; should be the worst
 * performer over a large sample.
 */
export const random: Bot = {
  name: 'bot_random',
  decide(ctx: MarketContext): DesiredOrder[] {
    if (ctx.market.status !== 'OPEN') return [];
    if (Math.random() > 0.25) return [];
    const outcome: 'YES' | 'NO' = Math.random() < 0.5 ? 'YES' : 'NO';
    const target = outcome === 'YES' ? ctx.fairYes : 100 - ctx.fairYes;
    const jitter = Math.round((Math.random() - 0.5) * 14);
    const price = clampCents(target + jitter);
    return [{ side: 'BUY', outcome, price, quantity: 5 }];
  },
};
