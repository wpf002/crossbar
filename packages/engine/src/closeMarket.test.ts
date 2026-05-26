import { describe, it, expect } from 'vitest';
import { prisma } from '@crossbar/db';
import { placeOrder } from './matcher.js';
import { closeMarket } from './lifecycle.js';
import { MarketAlreadyClosedError } from './errors.js';
import { makeFixture } from './test-fixtures.js';

describe('lifecycle.closeMarket', () => {
  it('cancels all OPEN/PARTIAL orders and releases buyer reservations', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();

    // Two open BUY orders + one open SELL (need shares first).
    await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 30, quantity: 10 },
      userA,
      ctx,
    );
    await placeOrder(
      { marketId, side: 'BUY', outcome: 'NO', price: 25, quantity: 20 },
      userB,
      ctx,
    );

    // Seed B with shares so they can post a SELL.
    await prisma.position.create({
      data: { userId: userB, marketId, yesShares: 50, avgYesCost: 30 },
    });
    await placeOrder(
      { marketId, side: 'SELL', outcome: 'YES', price: 70, quantity: 50 },
      userB,
      ctx,
    );

    const beforeA = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    const beforeB = await prisma.wallet.findUniqueOrThrow({ where: { userId: userB } });
    expect(beforeA.reserved).toBe(30 * 10);
    expect(beforeB.reserved).toBe(25 * 20);

    const result = await closeMarket(prisma, marketId);

    expect(result.market.status).toBe('CLOSED');
    expect(result.market.closedAt).not.toBeNull();
    expect(result.canceledOrders).toHaveLength(3);
    for (const o of result.canceledOrders) {
      expect(o.status).toBe('CANCELED');
    }

    const afterA = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    const afterB = await prisma.wallet.findUniqueOrThrow({ where: { userId: userB } });
    expect(afterA.reserved).toBe(0);
    expect(afterA.balance).toBe(100_000);
    expect(afterB.reserved).toBe(0);
    expect(afterB.balance).toBe(100_000);
  });

  it('is idempotent — calling on an already CLOSED market no-ops', async () => {
    const { marketId } = await makeFixture();

    const first = await closeMarket(prisma, marketId);
    expect(first.market.status).toBe('CLOSED');

    const second = await closeMarket(prisma, marketId);
    expect(second.market.status).toBe('CLOSED');
    expect(second.canceledOrders).toHaveLength(0);
  });

  it('throws if the market is already RESOLVED', async () => {
    const { marketId } = await makeFixture();
    await prisma.market.update({
      where: { id: marketId },
      data: { status: 'RESOLVED', outcome: 'YES', resolvedAt: new Date() },
    });

    await expect(closeMarket(prisma, marketId)).rejects.toBeInstanceOf(MarketAlreadyClosedError);
  });

  it('only refunds the unfilled portion of a partially-filled BUY', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();

    // Seed B with shares so they can post a partial SELL.
    await prisma.position.create({
      data: { userId: userB, marketId, yesShares: 100, avgYesCost: 30 },
    });

    await placeOrder(
      { marketId, side: 'SELL', outcome: 'YES', price: 50, quantity: 30 },
      userB,
      ctx,
    );
    // A buys 100 @ 60. Should fill 30 from B, leave 70 resting at 60.
    await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 100 },
      userA,
      ctx,
    );

    const walletA = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    // reservation = 60 * 70 (unfilled portion)
    expect(walletA.reserved).toBe(60 * 70);

    await closeMarket(prisma, marketId);

    const afterA = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    expect(afterA.reserved).toBe(0);
    // Started with 100_000; spent 50*30=1500 on the fill, rest refunded.
    expect(afterA.balance).toBe(100_000 - 50 * 30);
  });
});
