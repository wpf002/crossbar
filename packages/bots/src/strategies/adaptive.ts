import { clampCents } from '../fair-value.js';
import { bucketKey, defaultLearner, type CalibrationLearner } from '../learner.js';
import type { Bot, DesiredOrder, MarketContext } from '../types.js';

/**
 * Tier 2 adaptive — same trading logic as pinnacle, but pulls the fair YES
 * through a calibration learner first. The learner accumulates per-bucket
 * residuals from resolved markets; once a bucket has enough samples it pulls
 * the fair toward the empirical truth.
 */
export function makeAdaptive(learner: CalibrationLearner = defaultLearner): Bot {
  return {
    name: 'bot_adaptive',
    decide(ctx: MarketContext): DesiredOrder[] {
      if (ctx.market.status !== 'OPEN') return [];
      if (ctx.fairConfidence === 'low') return [];

      const bucket = bucketKey(ctx.event.sportId, ctx.market.type, ctx.fairYes);
      const fair = learner.adjust(bucket, ctx.fairYes);

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
}

/** Default-singleton adaptive bot — bound to the module-level learner. */
export const adaptive: Bot = makeAdaptive();
