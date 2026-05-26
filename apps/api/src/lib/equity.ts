import type { PrismaClient } from '@crossbar/db';

export interface EquityPoint {
  ts: string; // ISO date
  equity: number; // cents
}

export interface EquityResult {
  points: EquityPoint[];
}

interface PositionState {
  yesShares: number;
  noShares: number;
}

interface FillEvent {
  ts: Date;
  marketId: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
}

const MAX_POINTS = 500;

/**
 * Reconstruct equity over time for a user. We pull TradeFill rows joined to
 * the user's own Orders — that's the right granularity because for cross
 * trades a user is only the *buyer* of one of the two Trade rows (the
 * "seller" slot on the other row is bookkeeping, not a real share movement).
 * Walking the user's own fills sidesteps that ambiguity.
 *
 * Mark-to-market uses the *current* last trade price for each market — a
 * v1 approximation; exact historical pricing is Phase 3 work.
 */
export async function computeEquitySeries(
  prisma: PrismaClient,
  userId: string,
  hours: number,
): Promise<EquityResult> {
  const since = new Date(Date.now() - hours * 3600_000);

  const [wallet, positions, rawFills] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.position.findMany({ where: { userId } }),
    prisma.tradeFill.findMany({
      where: {
        order: { userId },
        trade: { createdAt: { gte: since } },
      },
      include: {
        order: { select: { side: true } },
        trade: {
          select: { marketId: true, outcome: true, price: true, createdAt: true },
        },
      },
      orderBy: { trade: { createdAt: 'asc' } },
    }),
  ]);

  // Filter out the bookkeeping trade-fills: TradeFill exists only for the
  // user's actual order, so every row here represents a real share movement.
  const fills: FillEvent[] = rawFills
    .filter((f) => f.trade.outcome === 'YES' || f.trade.outcome === 'NO')
    .map((f) => ({
      ts: f.trade.createdAt,
      marketId: f.trade.marketId,
      outcome: f.trade.outcome as 'YES' | 'NO',
      side: f.order.side as 'BUY' | 'SELL',
      price: f.trade.price,
      quantity: f.quantity,
    }));

  const currentCash = (wallet?.balance ?? 0) + (wallet?.reserved ?? 0);
  const currentPositions = new Map<string, PositionState>();
  for (const p of positions) {
    currentPositions.set(p.marketId, {
      yesShares: p.yesShares,
      noShares: p.noShares,
    });
  }

  // Mark-to-market prices.
  const marketIds = new Set<string>();
  for (const p of positions) marketIds.add(p.marketId);
  for (const f of fills) marketIds.add(f.marketId);
  const lastPrices = await lastTradePrices(prisma, [...marketIds]);

  // ── Rewind to starting state ────────────────────────────────────────────
  let startCash = currentCash;
  const startPositions = new Map<string, PositionState>(
    [...currentPositions].map(([k, v]) => [k, { ...v }]),
  );

  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i]!;
    const ps = startPositions.get(f.marketId) ?? { yesShares: 0, noShares: 0 };
    if (f.side === 'BUY') {
      startCash += f.price * f.quantity;
      if (f.outcome === 'YES') ps.yesShares -= f.quantity;
      else ps.noShares -= f.quantity;
    } else {
      startCash -= f.price * f.quantity;
      if (f.outcome === 'YES') ps.yesShares += f.quantity;
      else ps.noShares += f.quantity;
    }
    startPositions.set(f.marketId, ps);
  }

  // ── Walk forward, emitting one point per fill ───────────────────────────
  const points: EquityPoint[] = [];
  const cash = { value: startCash };
  const pos = new Map<string, PositionState>(
    [...startPositions].map(([k, v]) => [k, { ...v }]),
  );

  const emit = (ts: Date): void => {
    points.push({
      ts: ts.toISOString(),
      equity: equityAt(cash.value, pos, lastPrices),
    });
  };

  emit(since);

  for (const f of fills) {
    const ps = pos.get(f.marketId) ?? { yesShares: 0, noShares: 0 };
    if (f.side === 'BUY') {
      cash.value -= f.price * f.quantity;
      if (f.outcome === 'YES') ps.yesShares += f.quantity;
      else ps.noShares += f.quantity;
    } else {
      cash.value += f.price * f.quantity;
      if (f.outcome === 'YES') ps.yesShares -= f.quantity;
      else ps.noShares -= f.quantity;
    }
    pos.set(f.marketId, ps);
    emit(f.ts);
  }

  // Anchor an endpoint at "now" so the chart extends to the current time.
  const now = new Date();
  const last = points[points.length - 1];
  if (!last || last.ts !== now.toISOString()) {
    emit(now);
  }

  return { points: downSample(points, MAX_POINTS) };
}

function equityAt(
  cash: number,
  positions: Map<string, PositionState>,
  lastPrices: Map<string, number | null>,
): number {
  let positionValue = 0;
  for (const [marketId, p] of positions) {
    const last = lastPrices.get(marketId);
    if (last == null) continue;
    positionValue += p.yesShares * last + p.noShares * (100 - last);
  }
  return Math.round(cash + positionValue);
}

async function lastTradePrices(
  prisma: PrismaClient,
  marketIds: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (marketIds.length === 0) return out;
  // YES-only — the rest of the app treats the YES price as the canonical
  // mark, with NO mark = 100 - last YES price. Picking YES makes cross-trade
  // pairs unambiguous (the YES side is the user-facing price).
  const rows = await prisma.trade.findMany({
    where: { marketId: { in: marketIds }, outcome: 'YES' },
    orderBy: { createdAt: 'desc' },
    select: { marketId: true, price: true },
  });
  for (const r of rows) {
    if (!out.has(r.marketId)) out.set(r.marketId, r.price);
  }
  for (const id of marketIds) {
    if (!out.has(id)) out.set(id, null);
  }
  return out;
}

/**
 * Reduce a series to at most `maxPoints` by uniform-stride bucketing.
 * Always keeps the first and last points.
 */
function downSample(points: EquityPoint[], maxPoints: number): EquityPoint[] {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const out: EquityPoint[] = [];
  for (let i = 0; i < points.length; i += stride) {
    out.push(points[i]!);
  }
  const last = points[points.length - 1]!;
  if (out[out.length - 1]!.ts !== last.ts) out.push(last);
  return out;
}
