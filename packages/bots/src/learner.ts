import type { Event, Market, PrismaClient } from '@prisma/client';
import { clampCents, fairValueFor } from './fair-value.js';

/**
 * Bucket key for calibration corrections. We slice by sport + market type +
 * 10-cent fair bin — the same slicing used in the calibration dashboard so
 * the corrections map 1:1 to bins a human can inspect.
 */
export function bucketKey(sportId: string, marketType: string, fairYes: number): string {
  const bin = Math.max(0, Math.min(9, Math.floor(fairYes / 10)));
  return `${sportId}:${marketType}:${bin}`;
}

export interface LearnerSnapshotEntry {
  bucket: string;
  sportId: string;
  marketType: string;
  bin: number;
  /** Cents to add to a raw fair-YES prediction in this bucket. */
  correction: number;
  samples: number;
}

export interface LearnerSnapshot {
  entries: LearnerSnapshotEntry[];
  totalSamples: number;
  lastRefreshAt: string | null;
}

interface BucketState {
  /** EWMA of residual = actual_yes_pct − predicted_yes_pct, in cents. */
  correction: number;
  samples: number;
}

export interface LearnerOptions {
  /** EWMA smoothing factor. 0 = freeze; 1 = no smoothing. */
  alpha?: number;
  /** Don't apply corrections until we've seen at least this many samples. */
  minSamples?: number;
  /** Hard cap on correction magnitude, in cents. */
  maxCorrection?: number;
}

const DEFAULT_OPTS: Required<LearnerOptions> = {
  alpha: 0.15,
  minSamples: 5,
  maxCorrection: 20,
};

/**
 * Maintains a per-bucket calibration correction by observing realized outcomes
 * from RESOLVED markets. Pure in-memory; the maker process owns the lifecycle
 * and calls `refreshFromDb` on each tick.
 */
export class CalibrationLearner {
  private buckets = new Map<string, BucketState>();
  private opts: Required<LearnerOptions>;
  private resolvedSeen = new Set<string>();
  private lastRefreshAt: Date | null = null;

  constructor(opts: LearnerOptions = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  /**
   * Apply a single observation. `predictedYes` and `actualYes` are in cents
   * (0–100). Returns the new correction for the bucket.
   */
  record(bucket: string, predictedYes: number, actualYes: 0 | 100): number {
    const state = this.buckets.get(bucket) ?? { correction: 0, samples: 0 };
    const residual = actualYes - predictedYes;
    const next = state.correction + this.opts.alpha * (residual - state.correction);
    const clamped = Math.max(
      -this.opts.maxCorrection,
      Math.min(this.opts.maxCorrection, next),
    );
    state.correction = clamped;
    state.samples += 1;
    this.buckets.set(bucket, state);
    return clamped;
  }

  /**
   * Return the adjusted fair YES price for a bucket, or the raw value if we
   * don't have enough samples to trust the correction.
   */
  adjust(bucket: string, rawFairYes: number): number {
    const state = this.buckets.get(bucket);
    if (!state || state.samples < this.opts.minSamples) return rawFairYes;
    return clampCents(rawFairYes + state.correction);
  }

  snapshot(): LearnerSnapshot {
    const entries: LearnerSnapshotEntry[] = [];
    let total = 0;
    for (const [bucket, state] of this.buckets) {
      const [sportId, marketType, binStr] = bucket.split(':');
      entries.push({
        bucket,
        sportId: sportId ?? '',
        marketType: marketType ?? '',
        bin: Number(binStr ?? 0),
        correction: Math.round(state.correction * 100) / 100,
        samples: state.samples,
      });
      total += state.samples;
    }
    entries.sort((a, b) => b.samples - a.samples);
    return {
      entries,
      totalSamples: total,
      lastRefreshAt: this.lastRefreshAt?.toISOString() ?? null,
    };
  }

  /** Discard all state — used in tests. */
  reset(): void {
    this.buckets.clear();
    this.resolvedSeen.clear();
    this.lastRefreshAt = null;
  }

  /**
   * Pull newly-resolved markets from Postgres and feed them into the learner.
   * Idempotent on market id — replaying refreshFromDb is safe.
   */
  async refreshFromDb(prisma: PrismaClient): Promise<{ ingested: number }> {
    const resolved = await prisma.market.findMany({
      where: {
        status: 'RESOLVED',
        outcome: { in: ['YES', 'NO'] },
      },
      include: { event: true },
      orderBy: { resolvedAt: 'asc' },
    });

    let ingested = 0;
    for (const m of resolved) {
      if (this.resolvedSeen.has(m.id)) continue;
      const observed = observeResolvedMarket(m, m.event);
      if (observed) {
        this.record(observed.bucket, observed.predictedYes, observed.actualYes);
        ingested += 1;
      }
      this.resolvedSeen.add(m.id);
    }
    this.lastRefreshAt = new Date();
    return { ingested };
  }
}

/**
 * Pure: extract (bucket, predicted, actual) from a resolved market. Returns
 * null when we can't compute a prediction (no odds → can't blame the model).
 */
export function observeResolvedMarket(
  market: Pick<Market, 'type' | 'line' | 'outcome'>,
  event: Pick<
    Event,
    'sportId' | 'spread' | 'overUnder' | 'homeMoneyLine' | 'awayMoneyLine'
  >,
): { bucket: string; predictedYes: number; actualYes: 0 | 100 } | null {
  if (market.outcome !== 'YES' && market.outcome !== 'NO') return null;
  const fair = fairValueFor(market, event);
  if (fair.confidence === 'low') return null;
  const bucket = bucketKey(event.sportId, market.type, fair.yesCents);
  const actualYes: 0 | 100 = market.outcome === 'YES' ? 100 : 0;
  return { bucket, predictedYes: fair.yesCents, actualYes };
}

/**
 * Module-level singleton. The maker process refreshes it from DB each tick
 * and the adaptive bot reads from it. Tests should call `reset()` first.
 */
export const defaultLearner = new CalibrationLearner();
