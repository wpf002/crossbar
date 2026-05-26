import { describe, it, expect } from 'vitest';
import { prisma } from '@crossbar/db';
import { placeOrder } from './matcher.js';
import { resolveMarket } from './lifecycle.js';
import { makeFixture } from './test-fixtures.js';

describe('lifecycle.resolveMarket', () => {
  it('pays YES holders $1/share on YES outcome, NO holders nothing', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();

    // A buys YES, B buys NO via a cross at 60/40.
    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 }, userB, ctx);
    await placeOrder({ marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 }, userA, ctx);

    const aBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    const bBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: userB } });
    expect(aBefore.balance).toBe(100_000 - 60 * 10);
    expect(bBefore.balance).toBe(100_000 - 40 * 10);

    const result = await resolveMarket(prisma, marketId, 'YES');
    expect(result.market.status).toBe('RESOLVED');
    expect(result.market.outcome).toBe('YES');
    expect(result.market.resolvedAt).not.toBeNull();

    const aAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    const bAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: userB } });
    // A got 10 * 100 = 1000¢ payout.
    expect(aAfter.balance).toBe(aBefore.balance + 1000);
    expect(bAfter.balance).toBe(bBefore.balance);

    // Positions zeroed.
    const pa = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: userA, marketId } },
    });
    const pb = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: userB, marketId } },
    });
    expect(pa.yesShares).toBe(0);
    expect(pa.noShares).toBe(0);
    expect(pb.yesShares).toBe(0);
    expect(pb.noShares).toBe(0);
    // realizedPnl reflects payout - cost basis
    expect(pa.realizedPnl).toBe(1000 - 60 * 10);
    expect(pb.realizedPnl).toBe(-40 * 10);
  });

  it('pays NO holders on NO outcome', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();
    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 }, userB, ctx);
    await placeOrder({ marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 }, userA, ctx);

    const result = await resolveMarket(prisma, marketId, 'NO');
    expect(result.market.outcome).toBe('NO');

    const bAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: userB } });
    // B started 100_000, spent 400 on NO shares, gets 1000 back.
    expect(bAfter.balance).toBe(100_000 - 400 + 1000);
  });

  it('refunds cost basis on INVALID outcome (market status VOIDED)', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();
    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 }, userB, ctx);
    await placeOrder({ marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 }, userA, ctx);

    const result = await resolveMarket(prisma, marketId, 'INVALID');
    expect(result.market.status).toBe('VOIDED');
    expect(result.market.outcome).toBe('INVALID');

    const aAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    const bAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: userB } });
    // Both refunded their cost basis — net zero from start.
    expect(aAfter.balance).toBe(100_000);
    expect(bAfter.balance).toBe(100_000);

    const pa = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: userA, marketId } },
    });
    expect(pa.realizedPnl).toBe(0);
  });

  it('cancels open orders first when transitioning OPEN→RESOLVED', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();

    // First a fill so userA owns YES.
    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 }, userB, ctx);
    await placeOrder({ marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 }, userA, ctx);

    // Now leave a resting BUY on the book.
    await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 30, quantity: 5 },
      userA,
      ctx,
    );

    const wBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    // 100_000 - 600 (fill) - 150 (reservation) = 99_250 balance.
    expect(wBefore.balance).toBe(100_000 - 600 - 150);
    expect(wBefore.reserved).toBe(150);

    await resolveMarket(prisma, marketId, 'YES');

    const wAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    // Reservation released, payout credited.
    expect(wAfter.reserved).toBe(0);
    expect(wAfter.balance).toBe(100_000 - 600 + 1000);

    const restingOrders = await prisma.order.findMany({
      where: { marketId, status: { in: ['OPEN', 'PARTIAL'] } },
    });
    expect(restingOrders).toHaveLength(0);
  });

  it('serializes concurrent calls — second sees RESOLVED and no-ops (no double payout)', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();
    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 }, userB, ctx);
    await placeOrder({ marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 }, userA, ctx);

    const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });

    // Fire two resolves at once; the row lock should serialize them so userA
    // only gets paid out once (1000¢).
    const [r1, r2] = await Promise.all([
      resolveMarket(prisma, marketId, 'YES'),
      resolveMarket(prisma, marketId, 'YES'),
    ]);

    // Exactly one of the two should have done the actual payout.
    const totalPayouts = r1.payouts.length + r2.payouts.length;
    expect(totalPayouts).toBe(1);

    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    expect(after.balance).toBe(before.balance + 1000);
  });

  it('is idempotent — calling on an already-RESOLVED market no-ops', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();
    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 }, userB, ctx);
    await placeOrder({ marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 }, userA, ctx);

    await resolveMarket(prisma, marketId, 'YES');
    const aMid = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });

    // Re-resolve — should not pay out again.
    const second = await resolveMarket(prisma, marketId, 'YES');
    expect(second.payouts).toHaveLength(0);

    const aAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    expect(aAfter.balance).toBe(aMid.balance);
  });
});
