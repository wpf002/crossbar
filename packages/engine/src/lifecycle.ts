import type { Market, Order, Prisma, PrismaClient } from '@prisma/client';
import {
  MarketAlreadyClosedError,
  MarketNotFoundError,
} from './errors.js';

export type Tx = Prisma.TransactionClient;

export interface CloseMarketResult {
  market: Market;
  canceledOrders: Order[];
}

export interface PayoutEntry {
  userId: string;
  payout: number; // cents
}

export interface ResolveMarketResult {
  market: Market;
  payouts: PayoutEntry[];
}

export interface VoidMarketResult {
  market: Market;
  refunds: PayoutEntry[];
}

/**
 * Close an open market: cancel all resting orders and release reservations.
 * Idempotent — calling on a CLOSED market no-ops; RESOLVED/VOIDED throws.
 */
export async function closeMarket(
  prisma: PrismaClient,
  marketId: string,
): Promise<CloseMarketResult> {
  return prisma.$transaction(async (tx) => {
    const market = await loadMarketLocked(tx, marketId);

    if (market.status === 'RESOLVED' || market.status === 'VOIDED') {
      throw new MarketAlreadyClosedError(marketId);
    }
    if (market.status === 'CLOSED') {
      return { market, canceledOrders: [] };
    }

    const { market: updated, canceledOrders } = await closeMarketInTx(tx, market);
    return { market: updated, canceledOrders };
  });
}

/**
 * Resolve a market with a final outcome. Pays out positions and zeroes them.
 * Idempotent — calling on a RESOLVED/VOIDED market no-ops.
 * If the market is still OPEN, inlines the closeMarket logic first.
 */
export async function resolveMarket(
  prisma: PrismaClient,
  marketId: string,
  outcome: 'YES' | 'NO' | 'INVALID',
): Promise<ResolveMarketResult> {
  return prisma.$transaction(async (tx) => {
    const market = await loadMarketLocked(tx, marketId);

    if (market.status === 'RESOLVED' || market.status === 'VOIDED') {
      return { market, payouts: [] };
    }

    let working = market;
    if (working.status === 'OPEN') {
      const closed = await closeMarketInTx(tx, working);
      working = closed.market;
    }

    const finalStatus = outcome === 'INVALID' ? 'VOIDED' : 'RESOLVED';
    const updated = await tx.market.update({
      where: { id: marketId },
      data: {
        status: finalStatus,
        outcome,
        resolvedAt: new Date(),
      },
    });

    const payouts = await payoutPositions(tx, marketId, outcome);
    return { market: updated, payouts };
  });
}

/**
 * Void a market: equivalent to resolving with INVALID. Logs `reason` (not
 * stored — schema has no field).
 */
export async function voidMarket(
  prisma: PrismaClient,
  marketId: string,
  _reason: string,
): Promise<VoidMarketResult> {
  const result = await resolveMarket(prisma, marketId, 'INVALID');
  return { market: result.market, refunds: result.payouts };
}

async function loadMarketLocked(tx: Tx, marketId: string): Promise<Market> {
  // Take a row-level write lock so concurrent close/resolve/void attempts
  // serialize: the second caller blocks until the first commits, then sees
  // the updated status and the status guards make it a no-op or throw.
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Market" WHERE id = ${marketId} FOR UPDATE
  `;
  if (locked.length === 0) throw new MarketNotFoundError(marketId);
  // Lock acquired — fetch the full typed row.
  return tx.market.findUniqueOrThrow({ where: { id: marketId } });
}

async function closeMarketInTx(
  tx: Tx,
  market: Market,
): Promise<CloseMarketResult> {
  const openOrders = await tx.order.findMany({
    where: {
      marketId: market.id,
      status: { in: ['OPEN', 'PARTIAL'] },
    },
  });

  const canceledOrders: Order[] = [];
  for (const order of openOrders) {
    const unfilled = order.quantity - order.filled;
    if (order.side === 'BUY' && unfilled > 0) {
      const release = order.price * unfilled;
      await tx.wallet.update({
        where: { userId: order.userId },
        data: {
          reserved: { decrement: release },
          balance: { increment: release },
        },
      });
    }
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELED' },
    });
    canceledOrders.push(updated);
  }

  const updated = await tx.market.update({
    where: { id: market.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
    },
  });

  return { market: updated, canceledOrders };
}

async function payoutPositions(
  tx: Tx,
  marketId: string,
  outcome: 'YES' | 'NO' | 'INVALID',
): Promise<PayoutEntry[]> {
  const positions = await tx.position.findMany({ where: { marketId } });
  const payouts: PayoutEntry[] = [];

  for (const p of positions) {
    let payout = 0;
    let realizedDelta = 0;

    if (outcome === 'YES') {
      payout = p.yesShares * 100;
      const yesCost = (p.avgYesCost ?? 0) * p.yesShares;
      const noCost = (p.avgNoCost ?? 0) * p.noShares;
      realizedDelta = payout - yesCost - noCost;
    } else if (outcome === 'NO') {
      payout = p.noShares * 100;
      const yesCost = (p.avgYesCost ?? 0) * p.yesShares;
      const noCost = (p.avgNoCost ?? 0) * p.noShares;
      realizedDelta = payout - yesCost - noCost;
    } else {
      // INVALID — refund cost basis (treat null avgs as 0)
      const yesRefund = (p.avgYesCost ?? 0) * p.yesShares;
      const noRefund = (p.avgNoCost ?? 0) * p.noShares;
      payout = yesRefund + noRefund;
      // No P&L impact: we're returning what they paid.
      realizedDelta = 0;
    }

    if (payout > 0) {
      await tx.wallet.update({
        where: { userId: p.userId },
        data: { balance: { increment: payout } },
      });
    }

    await tx.position.update({
      where: { id: p.id },
      data: {
        yesShares: 0,
        noShares: 0,
        avgYesCost: null,
        avgNoCost: null,
        realizedPnl: { increment: realizedDelta },
      },
    });

    if (payout > 0) {
      payouts.push({ userId: p.userId, payout });
    }
  }

  return payouts;
}
