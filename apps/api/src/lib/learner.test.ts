import { describe, expect, it } from 'vitest';
import {
  CalibrationLearner,
  makeAdaptive,
  observeResolvedMarket,
  pinnacle,
  fairValueFor,
  type MarketContext,
} from '@crossbar/bots';

describe('CalibrationLearner', () => {
  it('records observations and yields a snapshot', () => {
    const l = new CalibrationLearner({ alpha: 0.5, minSamples: 1, maxCorrection: 50 });
    l.record('mlb:MONEYLINE:4', 45, 0);
    l.record('mlb:MONEYLINE:4', 45, 0);
    const snap = l.snapshot();
    expect(snap.totalSamples).toBe(2);
    const entry = snap.entries.find((e) => e.bucket === 'mlb:MONEYLINE:4');
    expect(entry).toBeTruthy();
    expect(entry!.correction).toBeLessThan(0); // predicted 45, actual 0 → negative
  });

  it("doesn't apply corrections below minSamples threshold", () => {
    const l = new CalibrationLearner({ alpha: 0.5, minSamples: 5 });
    l.record('nfl:SPREAD:5', 55, 0);
    // 1 sample, but min is 5 → adjust returns raw value
    expect(l.adjust('nfl:SPREAD:5', 55)).toBe(55);
  });

  it("clamps corrections to maxCorrection", () => {
    const l = new CalibrationLearner({ alpha: 1, minSamples: 1, maxCorrection: 10 });
    // alpha=1 → correction takes residual directly. residual = 0 - 80 = -80
    l.record('mlb:MONEYLINE:8', 80, 0);
    expect(l.adjust('mlb:MONEYLINE:8', 80)).toBe(80 - 10); // capped at -10
  });

  it('converges toward the empirical truth in a biased bucket', () => {
    // Deterministic: bucket predicted 45¢, but the *true* outcome rate is 25%
    // YES. We feed exactly that ratio (25 wins / 75 losses, repeated). Because
    // EWMA on iid Bernoulli draws has non-trivial variance, we use a low
    // alpha and a deterministic interleaved order so steady state is stable.
    const l = new CalibrationLearner({ alpha: 0.05, minSamples: 1, maxCorrection: 50 });
    const bucket = 'mlb:MONEYLINE:4';
    // 800 samples in deterministic 25/75 order — many full cycles.
    for (let cycle = 0; cycle < 200; cycle++) {
      // Each 4-sample cycle: 1 YES, 3 NO → 25% rate exactly.
      l.record(bucket, 45, 100);
      l.record(bucket, 45, 0);
      l.record(bucket, 45, 0);
      l.record(bucket, 45, 0);
    }
    const adjusted = l.adjust(bucket, 45);
    // Expected steady state: E[residual] = 0.25*55 + 0.75*(-45) = -20 → 25¢.
    expect(adjusted).toBeGreaterThanOrEqual(22);
    expect(adjusted).toBeLessThanOrEqual(28);
  });
});

describe('observeResolvedMarket', () => {
  it('skips markets without enough odds data', () => {
    const r = observeResolvedMarket(
      { type: 'MONEYLINE', line: null, outcome: 'YES' },
      {
        sportId: 'mlb',
        spread: null,
        overUnder: null,
        homeMoneyLine: null,
        awayMoneyLine: null,
      },
    );
    expect(r).toBeNull();
  });

  it('extracts bucket+prediction+actual from a resolved moneyline', () => {
    const r = observeResolvedMarket(
      { type: 'MONEYLINE', line: null, outcome: 'YES' },
      {
        sportId: 'mlb',
        spread: -1.5,
        overUnder: null,
        homeMoneyLine: -150,
        awayMoneyLine: 130,
      },
    );
    expect(r).not.toBeNull();
    expect(r!.actualYes).toBe(100);
    expect(r!.bucket.startsWith('mlb:MONEYLINE:')).toBe(true);
    // -150 / +130 de-vigged is ~0.59 → bin 5
    expect(r!.bucket).toBe('mlb:MONEYLINE:5');
    expect(r!.predictedYes).toBeGreaterThan(50);
  });
});

describe('adaptive vs pinnacle Brier (head-to-head)', () => {
  it('adaptive beats pinnacle when ESPN odds carry a systematic bias', () => {
    // Build a synthetic dataset where ESPN odds OVERESTIMATE the home win
    // probability by 10 percentage points for mlb favorites. With no learning,
    // pinnacle takes the biased fair as truth and gets bad Brier in that bin.
    // The adaptive bot learns the residual and corrects toward truth.
    const rng = mulberry32(42);
    const N_TRAIN = 400;
    const N_TEST = 200;

    const trainEvents = synthesize(N_TRAIN, rng);
    const testEvents = synthesize(N_TEST, rng);

    const learner = new CalibrationLearner({ alpha: 0.1, minSamples: 10 });
    const adaptiveBot = makeAdaptive(learner);

    // Train: feed each resolved event into the learner.
    for (const ev of trainEvents) {
      const r = observeResolvedMarket(
        { type: 'MONEYLINE', line: null, outcome: ev.homeWon ? 'YES' : 'NO' },
        {
          sportId: ev.sportId,
          spread: null,
          overUnder: null,
          homeMoneyLine: ev.homeMoneyLine,
          awayMoneyLine: ev.awayMoneyLine,
        },
      );
      if (r) learner.record(r.bucket, r.predictedYes, r.actualYes);
    }

    // Test: score both bots on held-out events.
    let pBrier = 0;
    let aBrier = 0;
    let pCount = 0;
    let aCount = 0;
    for (const ev of testEvents) {
      const ctx = synthCtx(ev);
      // Pinnacle uses fairYes directly as its implied probability.
      const pImpliedYes = inferImpliedYes(pinnacle, ctx);
      const aImpliedYes = inferImpliedYes(adaptiveBot, ctx);
      const actual = ev.homeWon ? 100 : 0;
      if (pImpliedYes != null) {
        pBrier += ((pImpliedYes - actual) / 100) ** 2;
        pCount += 1;
      }
      if (aImpliedYes != null) {
        aBrier += ((aImpliedYes - actual) / 100) ** 2;
        aCount += 1;
      }
    }
    const pinBrier = pBrier / Math.max(1, pCount);
    const adaBrier = aBrier / Math.max(1, aCount);
    // eslint-disable-next-line no-console
    console.log(
      `head-to-head Brier — pinnacle ${pinBrier.toFixed(4)} vs adaptive ${adaBrier.toFixed(4)}`,
    );
    expect(adaBrier).toBeLessThan(pinBrier);
  });
});

// ─── Test fixtures ───────────────────────────────────────────────────────────

interface SynthEvent {
  sportId: string;
  homeMoneyLine: number;
  awayMoneyLine: number;
  trueProb: number;
  homeWon: boolean;
}

/** Deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clip(p: number): number {
  return Math.max(0.05, Math.min(0.95, p));
}
function probToAmerican(p: number): number {
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

/**
 * Synthesize MLB events where ESPN's posted moneyline systematically OVER-
 * estimates the home team's win probability by 10pp. So an unbiased predictor
 * would beat pinnacle (which trusts ESPN literally) on Brier in that bin.
 */
function synthesize(n: number, rng: () => number): SynthEvent[] {
  const out: SynthEvent[] = [];
  for (let i = 0; i < n; i++) {
    const trueProb = 0.25 + rng() * 0.5;
    const biased = clip(trueProb + 0.1); // ESPN systematically inflates home favs
    out.push({
      sportId: 'mlb',
      homeMoneyLine: probToAmerican(biased),
      awayMoneyLine: probToAmerican(1 - biased),
      trueProb,
      homeWon: rng() < trueProb,
    });
  }
  return out;
}

function synthCtx(ev: SynthEvent): MarketContext {
  const eventStub = {
    id: 'sim',
    sportId: ev.sportId,
    startsAt: new Date(),
    status: 'SCHEDULED' as const,
    spread: null,
    overUnder: null,
    homeMoneyLine: ev.homeMoneyLine,
    awayMoneyLine: ev.awayMoneyLine,
    homeTeam: 'H',
    awayTeam: 'A',
  };
  const fair = fairValueFor({ type: 'MONEYLINE', line: null }, eventStub);
  return {
    market: {
      id: 'sim',
      type: 'MONEYLINE',
      line: null,
      status: 'OPEN',
      topOfBook: { yesBid: null, yesAsk: null, noBid: null, noAsk: null },
      lastTradePrice: null,
    },
    event: eventStub,
    recentTrades: [],
    fairYes: fair.yesCents,
    fairConfidence: fair.confidence,
  };
}

/**
 * Given a bot's decide() output, derive the implied YES probability it's
 * betting on. The pinnacle/adaptive strategies post bids at (fair − 2¢) on
 * both YES and NO when there's no edge — we recover their implied fair as
 * the midpoint between the two bids.
 */
function inferImpliedYes(bot: { decide: (c: MarketContext) => unknown }, ctx: MarketContext): number | null {
  const orders = bot.decide(ctx) as Array<{
    side: 'BUY' | 'SELL';
    outcome: 'YES' | 'NO';
    price: number;
    quantity: number;
  }>;
  if (orders.length === 0) return null;
  const yesBid = orders.find((o) => o.side === 'BUY' && o.outcome === 'YES');
  const noBid = orders.find((o) => o.side === 'BUY' && o.outcome === 'NO');
  if (yesBid && noBid) {
    // Each is fair±2; recover fair = (yesBid + (100 - noBid)) / 2
    return (yesBid.price + (100 - noBid.price)) / 2;
  }
  if (yesBid) return yesBid.price;
  if (noBid) return 100 - noBid.price;
  return null;
}
