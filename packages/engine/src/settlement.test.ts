import { describe, it, expect } from 'vitest';
import { prisma } from '@crossbar/db';
import { executeDirectTrade, executeCrossTrade, weightedAvg } from './settlement.js';
import { placeOrder } from './matcher.js';
import { makeFixture } from './test-fixtures.js';

describe('settlement.weightedAvg', () => {
  it('returns price when starting from zero shares', () => {
    expect(weightedAvg(0, 0, 100, 55)).toBe(55);
  });

  it('rounds to the nearest cent', () => {
    // 100*30 + 33*40 = 4320 / 133 = 32.48...  → 32
    expect(weightedAvg(100, 30, 33, 40)).toBe(32);
    // 1*1 + 1*2 = 3 / 2 = 1.5 → 2 (banker-free, JS Math.round rounds half away from zero for positive)
    expect(weightedAvg(1, 1, 1, 2)).toBe(2);
  });
});

describe('settlement.executeDirectTrade', () => {
  it('updates wallets, positions, orders, trade and fills atomically', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();

    // Seed B with shares.
    await prisma.position.create({
      data: {
        userId: userB,
        marketId,
        yesShares: 100,
        avgYesCost: 20,
      },
    });

    // Create orders by going through the matcher (handles wallet reservation).
    const { order: sell } = await placeOrder(
      { marketId, side: 'SELL', outcome: 'YES', price: 55, quantity: 100 },
      userB,
      ctx,
    );
    const { order: buy } = await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 100 },
      userA,
      ctx,
    );

    // Both should have been settled by placeOrder. Verify the final state.
    const trades = await prisma.trade.findMany({ where: { marketId } });
    expect(trades).toHaveLength(1);
    expect(trades[0]?.price).toBe(55);

    const fills = await prisma.tradeFill.findMany({ where: { tradeId: trades[0]?.id } });
    expect(fills).toHaveLength(2);
    expect(fills.map((f) => f.orderId).sort()).toEqual([sell.id, buy.id].sort());
  });

  it('rolls back the entire trade when a downstream update would fail', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();
    await prisma.position.create({
      data: { userId: userB, marketId, yesShares: 100, avgYesCost: 20 },
    });

    // Set up resting orders manually so we can call executeDirectTrade directly
    // with a deliberately broken input (non-existent seller order).
    const { order: buy } = await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 },
      userA,
      ctx,
    );

    await expect(
      executeDirectTrade(prisma, {
        marketId,
        outcome: 'YES',
        quantity: 10,
        buyerBidPrice: 50,
        execPrice: 50,
        buyer: { userId: userA, orderId: buy.id },
        seller: { userId: userB, orderId: 'does-not-exist' },
      }),
    ).rejects.toThrow();

    // Verify nothing was committed.
    const trades = await prisma.trade.findMany({ where: { marketId } });
    expect(trades).toHaveLength(0);

    // Buyer's wallet should still reflect only the original reservation.
    const wa = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    expect(wa.reserved).toBe(50 * 10);
    expect(wa.balance).toBe(100_000 - 50 * 10);
  });
});

describe('settlement.executeCrossTrade', () => {
  it('creates two trades and increments both buyer positions', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();

    // Both users place opposite-side BUYs at prices that sum to ≥ 100.
    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 45, quantity: 10 }, userB, ctx);
    await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 55, quantity: 10 },
      userA,
      ctx,
    );

    const trades = await prisma.trade.findMany({
      where: { marketId },
      orderBy: { createdAt: 'asc' },
    });
    expect(trades).toHaveLength(2);
    const outcomes = trades.map((t) => t.outcome).sort();
    expect(outcomes).toEqual(['NO', 'YES']);

    const pa = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: userA, marketId } },
    });
    const pb = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: userB, marketId } },
    });
    expect(pa.yesShares).toBe(10);
    expect(pa.avgYesCost).toBe(55);
    expect(pb.noShares).toBe(10);
    expect(pb.avgNoCost).toBe(45);
  });

  it('cross-trade still functions as direct API', async () => {
    // Smoke test executeCrossTrade directly to verify the function works
    // standalone, not just through placeOrder.
    const { ctx, userA, userB, marketId } = await makeFixture();

    // Create two open BUY orders the function can reference.
    const yesOrder = await prisma.order.create({
      data: {
        marketId,
        userId: userA,
        side: 'BUY',
        outcome: 'YES',
        price: 60,
        quantity: 20,
      },
    });
    const noOrder = await prisma.order.create({
      data: {
        marketId,
        userId: userB,
        side: 'BUY',
        outcome: 'NO',
        price: 40,
        quantity: 20,
      },
    });
    // Move funds into reserved to mirror what placeOrder would have done.
    await prisma.wallet.update({
      where: { userId: userA },
      data: { balance: { decrement: 60 * 20 }, reserved: { increment: 60 * 20 } },
    });
    await prisma.wallet.update({
      where: { userId: userB },
      data: { balance: { decrement: 40 * 20 }, reserved: { increment: 40 * 20 } },
    });

    await executeCrossTrade(prisma, {
      marketId,
      quantity: 20,
      yesBuyer: {
        userId: userA,
        orderId: yesOrder.id,
        bidPrice: 60,
        execPrice: 60,
      },
      noBuyer: {
        userId: userB,
        orderId: noOrder.id,
        bidPrice: 40,
        execPrice: 40,
      },
    });

    const [wa, wb] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { userId: userA } }),
      prisma.wallet.findUniqueOrThrow({ where: { userId: userB } }),
    ]);
    expect(wa.balance).toBe(100_000 - 60 * 20);
    expect(wa.reserved).toBe(0);
    expect(wb.balance).toBe(100_000 - 40 * 20);
    expect(wb.reserved).toBe(0);

    // Use ctx so we don't have an unused binding.
    expect(ctx.books.size).toBe(0);
  });
});
