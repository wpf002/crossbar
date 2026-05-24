import { describe, it, expect } from 'vitest';
import { prisma } from '@crossbar/db';
import { placeOrder, cancelOrder } from './matcher.js';
import { InsufficientFundsError, InsufficientPositionError, MarketNotOpenError } from './errors.js';
import { makeFixture } from './test-fixtures.js';

describe('matcher.placeOrder — direct matches', () => {
  it('fills a BUY YES @ 60 against a resting SELL YES @ 60 in full', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();

    // Seed userB with 100 YES shares so they can SELL.
    await seedPosition(userB, marketId, { yesShares: 100, avgYesCost: 40 });

    const { order: sell } = await placeOrder(
      { marketId, side: 'SELL', outcome: 'YES', price: 60, quantity: 100 },
      userB,
      ctx,
    );
    expect(sell.status).toBe('OPEN');

    const { order: buy, fills } = await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 100 },
      userA,
      ctx,
    );

    expect(buy.status).toBe('FILLED');
    expect(buy.filled).toBe(100);
    expect(fills).toHaveLength(1);
    expect(fills[0]?.price).toBe(60);
    expect(fills[0]?.quantity).toBe(100);

    const updatedSell = await prisma.order.findUniqueOrThrow({ where: { id: sell.id } });
    expect(updatedSell.status).toBe('FILLED');

    // Wallets: A debited 60*100 = 6000; B credited 6000.
    const [wa, wb] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { userId: userA } }),
      prisma.wallet.findUniqueOrThrow({ where: { userId: userB } }),
    ]);
    expect(wa.balance).toBe(100_000 - 6_000);
    expect(wa.reserved).toBe(0);
    expect(wb.balance).toBe(100_000 + 6_000);

    // Positions: A holds 100 YES @ 60; B sold all 100, realized P&L = (60-40)*100.
    const [pa, pb] = await Promise.all([
      prisma.position.findUniqueOrThrow({
        where: { userId_marketId: { userId: userA, marketId } },
      }),
      prisma.position.findUniqueOrThrow({
        where: { userId_marketId: { userId: userB, marketId } },
      }),
    ]);
    expect(pa.yesShares).toBe(100);
    expect(pa.avgYesCost).toBe(60);
    expect(pb.yesShares).toBe(0);
    expect(pb.avgYesCost).toBeNull();
    expect(pb.realizedPnl).toBe((60 - 40) * 100);
  });

  it('partially fills the incoming order and rests the remainder', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();
    await seedPosition(userB, marketId, { yesShares: 60, avgYesCost: 30 });

    await placeOrder(
      { marketId, side: 'SELL', outcome: 'YES', price: 60, quantity: 60 },
      userB,
      ctx,
    );

    const { order: buy } = await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 100 },
      userA,
      ctx,
    );

    expect(buy.status).toBe('PARTIAL');
    expect(buy.filled).toBe(60);

    // A's wallet: reserved holds the unfilled 40 @ 60 = 2400; spent 60*60=3600.
    const wa = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    expect(wa.balance).toBe(100_000 - 60 * 60 - 40 * 60);
    expect(wa.reserved).toBe(40 * 60);
  });

  it('gives the taker price improvement (resting price wins)', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();
    await seedPosition(userB, marketId, { yesShares: 50, avgYesCost: 20 });

    // Resting ask at 55.
    await placeOrder(
      { marketId, side: 'SELL', outcome: 'YES', price: 55, quantity: 50 },
      userB,
      ctx,
    );

    // Taker bids 70 — should execute at 55.
    const { fills } = await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 70, quantity: 50 },
      userA,
      ctx,
    );
    expect(fills[0]?.price).toBe(55);

    const wa = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    // A reserved 70*50 = 3500, refunded (70-55)*50 = 750.
    expect(wa.balance).toBe(100_000 - 55 * 50);
    expect(wa.reserved).toBe(0);
  });
});

describe('matcher.placeOrder — cross-side matches', () => {
  it('matches BUY YES @ 60 against resting BUY NO @ 40 (no improvement)', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();

    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 50 }, userB, ctx);

    const { order: buy, fills } = await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 50 },
      userA,
      ctx,
    );

    expect(buy.status).toBe('FILLED');
    expect(fills).toHaveLength(2); // two trade rows for cross
    const yes = fills.find((f) => f.outcome === 'YES');
    const no = fills.find((f) => f.outcome === 'NO');
    expect(yes?.price).toBe(60);
    expect(no?.price).toBe(40);

    const [wa, wb] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { userId: userA } }),
      prisma.wallet.findUniqueOrThrow({ where: { userId: userB } }),
    ]);
    expect(wa.balance).toBe(100_000 - 60 * 50);
    expect(wa.reserved).toBe(0);
    expect(wb.balance).toBe(100_000 - 40 * 50);
    expect(wb.reserved).toBe(0);

    const [pa, pb] = await Promise.all([
      prisma.position.findUniqueOrThrow({
        where: { userId_marketId: { userId: userA, marketId } },
      }),
      prisma.position.findUniqueOrThrow({
        where: { userId_marketId: { userId: userB, marketId } },
      }),
    ]);
    expect(pa.yesShares).toBe(50);
    expect(pa.avgYesCost).toBe(60);
    expect(pa.noShares).toBe(0);
    expect(pb.noShares).toBe(50);
    expect(pb.avgNoCost).toBe(40);
    expect(pb.yesShares).toBe(0);
  });

  it('gives the taker price improvement on cross matches', async () => {
    const { ctx, userA, userB, marketId } = await makeFixture();

    // Resting BUY NO @ 40. Incoming BUY YES @ 70 — exec at YES=60 (=100-40).
    await placeOrder({ marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 25 }, userB, ctx);
    const { fills } = await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 70, quantity: 25 },
      userA,
      ctx,
    );

    const yes = fills.find((f) => f.outcome === 'YES');
    const no = fills.find((f) => f.outcome === 'NO');
    expect(yes?.price).toBe(60);
    expect(no?.price).toBe(40);

    const wa = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    // A reserved 70*25=1750, refund (70-60)*25=250, net debit 60*25=1500.
    expect(wa.balance).toBe(100_000 - 60 * 25);
    expect(wa.reserved).toBe(0);
  });
});

describe('matcher.placeOrder — self-trade prevention', () => {
  it('rests the incoming order instead of matching against the same user', async () => {
    const { ctx, userA, marketId } = await makeFixture();
    await seedPosition(userA, marketId, { yesShares: 50, avgYesCost: 20 });

    await placeOrder(
      { marketId, side: 'SELL', outcome: 'YES', price: 50, quantity: 50 },
      userA,
      ctx,
    );
    const { order: buy } = await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 50 },
      userA,
      ctx,
    );

    // Should rest, not fill.
    expect(buy.status).toBe('OPEN');
    expect(buy.filled).toBe(0);
  });
});

describe('matcher.placeOrder — eligibility', () => {
  it('rejects a BUY without sufficient balance', async () => {
    const { ctx, userA, marketId } = await makeFixture({ balanceCents: 1_000 });
    await expect(
      placeOrder({ marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 100 }, userA, ctx),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it('rejects a SELL without the shares', async () => {
    const { ctx, userA, marketId } = await makeFixture();
    await expect(
      placeOrder({ marketId, side: 'SELL', outcome: 'YES', price: 50, quantity: 10 }, userA, ctx),
    ).rejects.toBeInstanceOf(InsufficientPositionError);
  });

  it('rejects orders on a CLOSED market', async () => {
    const { ctx, userA, marketId } = await makeFixture();
    await prisma.market.update({ where: { id: marketId }, data: { status: 'CLOSED' } });

    await expect(
      placeOrder({ marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 }, userA, ctx),
    ).rejects.toBeInstanceOf(MarketNotOpenError);
  });
});

describe('matcher.cancelOrder', () => {
  it('returns reserved funds to balance', async () => {
    const { ctx, userA, marketId } = await makeFixture();
    const { order } = await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 100 },
      userA,
      ctx,
    );
    let wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    expect(wallet.reserved).toBe(50 * 100);
    expect(wallet.balance).toBe(100_000 - 50 * 100);

    const canceled = await cancelOrder(order.id, userA, ctx);
    expect(canceled.status).toBe('CANCELED');

    wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: userA } });
    expect(wallet.reserved).toBe(0);
    expect(wallet.balance).toBe(100_000);
  });
});

describe('matcher.placeOrder — weighted-avg cost basis', () => {
  it('100 shares @ 30 then 100 @ 50 produces avg = 40', async () => {
    const { ctx, userA, userB, userC, marketId } = await makeFixture();
    await seedPosition(userB, marketId, { yesShares: 100, avgYesCost: 10 });
    await seedPosition(userC, marketId, { yesShares: 100, avgYesCost: 10 });

    await placeOrder(
      { marketId, side: 'SELL', outcome: 'YES', price: 30, quantity: 100 },
      userB,
      ctx,
    );
    await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 30, quantity: 100 },
      userA,
      ctx,
    );

    await placeOrder(
      { marketId, side: 'SELL', outcome: 'YES', price: 50, quantity: 100 },
      userC,
      ctx,
    );
    await placeOrder(
      { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 100 },
      userA,
      ctx,
    );

    const pa = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: userA, marketId } },
    });
    expect(pa.yesShares).toBe(200);
    expect(pa.avgYesCost).toBe(40);
  });
});

async function seedPosition(
  userId: string,
  marketId: string,
  data: { yesShares?: number; noShares?: number; avgYesCost?: number; avgNoCost?: number },
): Promise<void> {
  await prisma.position.upsert({
    where: { userId_marketId: { userId, marketId } },
    update: data,
    create: {
      userId,
      marketId,
      yesShares: data.yesShares ?? 0,
      noShares: data.noShares ?? 0,
      avgYesCost: data.avgYesCost ?? null,
      avgNoCost: data.avgNoCost ?? null,
    },
  });
}
