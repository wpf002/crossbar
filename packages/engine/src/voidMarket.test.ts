import { describe, it, expect } from 'vitest';
import { prisma } from '@crossbar/db';
import { placeOrder } from './matcher.js';
import { voidMarket } from './lifecycle.js';
import { makeFixture } from './test-fixtures.js';

describe('lifecycle.voidMarket', () => {
  it('refunds cost basis to both sides and sets status to VOIDED', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();
    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 }, userB, ctx);
    await placeOrder({ marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 }, userA, ctx);

    const result = await voidMarket(prisma, marketId, 'game postponed');
    expect(result.market.status).toBe('VOIDED');
    expect(result.market.outcome).toBe('INVALID');

    const aAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    const bAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: userB } });
    expect(aAfter.balance).toBe(100_000);
    expect(bAfter.balance).toBe(100_000);
  });

  it('cancels open orders before voiding (releases reservations)', async () => {
    const { ctx, userA, marketId } = await makeFixture();
    await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 20 },
      userA,
      ctx,
    );

    await voidMarket(prisma, marketId, 'rained out');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    expect(wallet.reserved).toBe(0);
    expect(wallet.balance).toBe(100_000);
  });

  it('is idempotent', async () => {
    const { marketId } = await makeFixture();
    const first = await voidMarket(prisma, marketId, 'reason');
    expect(first.market.status).toBe('VOIDED');

    const second = await voidMarket(prisma, marketId, 'reason');
    expect(second.market.status).toBe('VOIDED');
    expect(second.refunds).toHaveLength(0);
  });
});
