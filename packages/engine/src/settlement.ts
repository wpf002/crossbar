import type { Prisma, PrismaClient, Trade } from '@prisma/client';
import type { OutcomeSide } from './book.js';

/**
 * Inputs for a direct match: a BUY hitting a SELL on the same outcome.
 * The seller's position decrements; the buyer's increments.
 */
export interface DirectTradeInput {
  marketId: string;
  outcome: OutcomeSide;
  quantity: number;
  /** Price the BUY order was placed at — drives how much to release from reserved. */
  buyerBidPrice: number;
  /** Resting order's price = execution price. */
  execPrice: number;
  buyer: { userId: string; orderId: string };
  seller: { userId: string; orderId: string };
}

/**
 * Inputs for a cross-side match: BUY YES + BUY NO together mint a fresh
 * pair. Both users end as buyers; their respective positions both increment.
 * `yesPrice + noPrice` always equals 100.
 */
export interface CrossTradeInput {
  marketId: string;
  quantity: number;
  yesBuyer: {
    userId: string;
    orderId: string;
    bidPrice: number;
    execPrice: number;
  };
  noBuyer: {
    userId: string;
    orderId: string;
    bidPrice: number;
    execPrice: number;
  };
}

type Tx = Prisma.TransactionClient;

/**
 * Atomically settle a direct trade. Returns the persisted Trade row.
 *
 * Steps (all within one prisma.$transaction):
 *   1. Insert Trade
 *   2. Insert two TradeFill rows (one per Order)
 *   3. Update both Order.filled / Order.status
 *   4. Update buyer wallet: reserved -= buyerBidPrice * qty,
 *      balance += (buyerBidPrice - execPrice) * qty  (refund improvement)
 *   5. Update seller wallet: balance += execPrice * qty
 *   6. Upsert buyer Position: shares += qty, weighted avg cost
 *   7. Update seller Position: shares -= qty, realized P&L += (execPrice - avgCost) * qty
 */
export async function executeDirectTrade(
  prisma: PrismaClient,
  input: DirectTradeInput,
): Promise<Trade> {
  return prisma.$transaction(async (tx) => {
    const { marketId, outcome, quantity, execPrice, buyerBidPrice, buyer, seller } = input;

    const trade = await tx.trade.create({
      data: {
        marketId,
        outcome,
        price: execPrice,
        quantity,
        buyerUserId: buyer.userId,
        sellerUserId: seller.userId,
      },
    });

    await tx.tradeFill.createMany({
      data: [
        { tradeId: trade.id, orderId: buyer.orderId, quantity },
        { tradeId: trade.id, orderId: seller.orderId, quantity },
      ],
    });

    await bumpOrderFill(tx, buyer.orderId, quantity);
    await bumpOrderFill(tx, seller.orderId, quantity);

    const buyerCost = execPrice * quantity;
    const reservedRelease = buyerBidPrice * quantity;
    const refund = reservedRelease - buyerCost; // ≥ 0 — price improvement

    await tx.wallet.update({
      where: { userId: buyer.userId },
      data: {
        reserved: { decrement: reservedRelease },
        balance: { increment: refund },
      },
    });

    await tx.wallet.update({
      where: { userId: seller.userId },
      data: { balance: { increment: buyerCost } },
    });

    await applyBuyToPosition(tx, {
      userId: buyer.userId,
      marketId,
      outcome,
      quantity,
      price: execPrice,
    });

    await applySellToPosition(tx, {
      userId: seller.userId,
      marketId,
      outcome,
      quantity,
      price: execPrice,
    });

    return trade;
  });
}

/**
 * Atomically settle a cross-side match. Records two Trade rows (one per outcome,
 * each with the counterparty in the "seller" slot for accounting) plus the
 * usual fill/order/wallet/position bookkeeping.
 *
 * Position semantics: only the buyer of each outcome gets shares — the
 * counterparty's position in that outcome is NOT decremented (no shares were
 * destroyed; a fresh pair was minted).
 */
export async function executeCrossTrade(
  prisma: PrismaClient,
  input: CrossTradeInput,
): Promise<{ yesTrade: Trade; noTrade: Trade }> {
  return prisma.$transaction(async (tx) => {
    const { marketId, quantity, yesBuyer, noBuyer } = input;

    const yesTrade = await tx.trade.create({
      data: {
        marketId,
        outcome: 'YES',
        price: yesBuyer.execPrice,
        quantity,
        buyerUserId: yesBuyer.userId,
        sellerUserId: noBuyer.userId,
      },
    });
    const noTrade = await tx.trade.create({
      data: {
        marketId,
        outcome: 'NO',
        price: noBuyer.execPrice,
        quantity,
        buyerUserId: noBuyer.userId,
        sellerUserId: yesBuyer.userId,
      },
    });

    await tx.tradeFill.createMany({
      data: [
        { tradeId: yesTrade.id, orderId: yesBuyer.orderId, quantity },
        { tradeId: noTrade.id, orderId: noBuyer.orderId, quantity },
      ],
    });

    await bumpOrderFill(tx, yesBuyer.orderId, quantity);
    await bumpOrderFill(tx, noBuyer.orderId, quantity);

    await releaseBuyerReservation(
      tx,
      yesBuyer.userId,
      yesBuyer.bidPrice,
      yesBuyer.execPrice,
      quantity,
    );
    await releaseBuyerReservation(
      tx,
      noBuyer.userId,
      noBuyer.bidPrice,
      noBuyer.execPrice,
      quantity,
    );

    await applyBuyToPosition(tx, {
      userId: yesBuyer.userId,
      marketId,
      outcome: 'YES',
      quantity,
      price: yesBuyer.execPrice,
    });
    await applyBuyToPosition(tx, {
      userId: noBuyer.userId,
      marketId,
      outcome: 'NO',
      quantity,
      price: noBuyer.execPrice,
    });

    return { yesTrade, noTrade };
  });
}

async function bumpOrderFill(tx: Tx, orderId: string, qty: number): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const newFilled = order.filled + qty;
  const status = newFilled >= order.quantity ? 'FILLED' : newFilled > 0 ? 'PARTIAL' : 'OPEN';
  await tx.order.update({
    where: { id: orderId },
    data: { filled: newFilled, status },
  });
}

async function releaseBuyerReservation(
  tx: Tx,
  userId: string,
  bidPrice: number,
  execPrice: number,
  quantity: number,
): Promise<void> {
  const reservedRelease = bidPrice * quantity;
  const refund = reservedRelease - execPrice * quantity;
  await tx.wallet.update({
    where: { userId },
    data: {
      reserved: { decrement: reservedRelease },
      balance: { increment: refund },
    },
  });
}

interface PositionDelta {
  userId: string;
  marketId: string;
  outcome: OutcomeSide;
  quantity: number;
  price: number;
}

async function applyBuyToPosition(tx: Tx, d: PositionDelta): Promise<void> {
  const existing = await tx.position.findUnique({
    where: { userId_marketId: { userId: d.userId, marketId: d.marketId } },
  });

  if (!existing) {
    await tx.position.create({
      data: {
        userId: d.userId,
        marketId: d.marketId,
        yesShares: d.outcome === 'YES' ? d.quantity : 0,
        noShares: d.outcome === 'NO' ? d.quantity : 0,
        avgYesCost: d.outcome === 'YES' ? d.price : null,
        avgNoCost: d.outcome === 'NO' ? d.price : null,
      },
    });
    return;
  }

  if (d.outcome === 'YES') {
    const oldShares = existing.yesShares;
    const oldAvg = existing.avgYesCost ?? 0;
    const newShares = oldShares + d.quantity;
    const newAvg = weightedAvg(oldShares, oldAvg, d.quantity, d.price);
    await tx.position.update({
      where: { id: existing.id },
      data: { yesShares: newShares, avgYesCost: newAvg },
    });
  } else {
    const oldShares = existing.noShares;
    const oldAvg = existing.avgNoCost ?? 0;
    const newShares = oldShares + d.quantity;
    const newAvg = weightedAvg(oldShares, oldAvg, d.quantity, d.price);
    await tx.position.update({
      where: { id: existing.id },
      data: { noShares: newShares, avgNoCost: newAvg },
    });
  }
}

async function applySellToPosition(tx: Tx, d: PositionDelta): Promise<void> {
  const existing = await tx.position.findUniqueOrThrow({
    where: { userId_marketId: { userId: d.userId, marketId: d.marketId } },
  });

  if (d.outcome === 'YES') {
    const avg = existing.avgYesCost ?? 0;
    const realized = (d.price - avg) * d.quantity;
    const newShares = existing.yesShares - d.quantity;
    await tx.position.update({
      where: { id: existing.id },
      data: {
        yesShares: newShares,
        avgYesCost: newShares === 0 ? null : existing.avgYesCost,
        realizedPnl: { increment: realized },
      },
    });
  } else {
    const avg = existing.avgNoCost ?? 0;
    const realized = (d.price - avg) * d.quantity;
    const newShares = existing.noShares - d.quantity;
    await tx.position.update({
      where: { id: existing.id },
      data: {
        noShares: newShares,
        avgNoCost: newShares === 0 ? null : existing.avgNoCost,
        realizedPnl: { increment: realized },
      },
    });
  }
}

/** (oldShares*oldAvg + qty*price) / (oldShares + qty), rounded to nearest cent. */
export function weightedAvg(oldShares: number, oldAvg: number, qty: number, price: number): number {
  const denom = oldShares + qty;
  if (denom <= 0) return price;
  return Math.round((oldShares * oldAvg + qty * price) / denom);
}
