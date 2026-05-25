import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@crossbar/db';
import { bearer, makeApp, makeClosedMarket, makeOpenMarket, signupUser } from '../test-helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

describe('POST /orders', () => {
  it('places a BUY and returns the order with empty fills (no counterparty)', async () => {
    const user = await signupUser(app);
    const marketId = await makeOpenMarket();

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      order: { id: string; status: string; price: number; quantity: number };
      fills: unknown[];
    };
    expect(body.order.status).toBe('OPEN');
    expect(body.order.price).toBe(50);
    expect(body.order.quantity).toBe(10);
    expect(body.fills).toHaveLength(0);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.balance).toBe(100_000 - 500);
    expect(wallet.reserved).toBe(500);
  });

  it('returns 401 without auth', async () => {
    const marketId = await makeOpenMarket();
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });

  it('returns 409 MARKET_NOT_OPEN on a closed market', async () => {
    const user = await signupUser(app);
    const marketId = await makeClosedMarket();
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'MARKET_NOT_OPEN' });
  });

  it('returns 402 INSUFFICIENT_FUNDS when wallet cannot cover the order', async () => {
    const user = await signupUser(app);
    const marketId = await makeOpenMarket();
    // 50¢ * 5000 shares = 250_000¢, wallet only has 100_000¢
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 5000 },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_FUNDS' });
  });

  it('returns 422 VALIDATION_ERROR on bad input (price > 99)', async () => {
    const user = await signupUser(app);
    const marketId = await makeOpenMarket();
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 150, quantity: 10 },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('DELETE /orders/:id', () => {
  it("cancels the user's own order and refunds reserved funds", async () => {
    const user = await signupUser(app);
    const marketId = await makeOpenMarket();
    const place = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 },
    });
    const { order } = place.json() as { order: { id: string } };

    const res = await app.inject({
      method: 'DELETE',
      url: `/orders/${order.id}`,
      headers: bearer(user.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ order: { id: order.id, status: 'CANCELED' } });

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.balance).toBe(100_000);
    expect(wallet.reserved).toBe(0);
  });

  it("returns 403 when canceling someone else's order", async () => {
    const owner = await signupUser(app);
    const intruder = await signupUser(app);
    const marketId = await makeOpenMarket();
    const place = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(owner.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 },
    });
    const { order } = place.json() as { order: { id: string } };

    const res = await app.inject({
      method: 'DELETE',
      url: `/orders/${order.id}`,
      headers: bearer(intruder.token),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('returns 404 for a non-existent order', async () => {
    const user = await signupUser(app);
    const res = await app.inject({
      method: 'DELETE',
      url: '/orders/does-not-exist',
      headers: bearer(user.token),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'ORDER_NOT_FOUND' });
  });
});

describe('matching', () => {
  it('direct match: BUY hits resting SELL, both wallets/positions update', async () => {
    const buyer = await signupUser(app);
    const seller = await signupUser(app);
    const marketId = await makeOpenMarket();

    // Seller needs YES shares first. Easiest path: seller buys 10 YES @ 60¢
    // from a third party who BUYs NO @ 40¢ (cross match → mints pair).
    const pairFunder = await signupUser(app);
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(seller.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(pairFunder.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 },
    });
    const sellerPos = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: seller.id, marketId } },
    });
    expect(sellerPos.yesShares).toBe(10);

    // Now seller rests a SELL @ 70¢
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(seller.token),
      payload: { marketId, side: 'SELL', outcome: 'YES', price: 70, quantity: 10 },
    });

    // Buyer hits it: BUY YES @ 80¢ (limit), execs at resting 70¢
    const sellerBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: seller.id } });
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(buyer.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 80, quantity: 10 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { order: { status: string }; fills: Array<{ price: number; quantity: number }> };
    expect(body.order.status).toBe('FILLED');
    expect(body.fills).toHaveLength(1);
    expect(body.fills[0]!.price).toBe(70);
    expect(body.fills[0]!.quantity).toBe(10);

    // Buyer wallet: started 100_000, paid 700¢ → 99_300, reserved 0
    const buyerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer.id } });
    expect(buyerWallet.balance).toBe(100_000 - 700);
    expect(buyerWallet.reserved).toBe(0);

    // Seller wallet: receives 700¢ for the sale (no reservation existed)
    const sellerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: seller.id } });
    expect(sellerWallet.balance).toBe(sellerBefore.balance + 700);

    // Buyer holds 10 YES, seller now holds 0
    const buyerPos = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: buyer.id, marketId } },
    });
    expect(buyerPos.yesShares).toBe(10);
    const sellerPosAfter = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: seller.id, marketId } },
    });
    expect(sellerPosAfter.yesShares).toBe(0);
  });

  it('cross match: BUY YES + BUY NO mints a fresh pair for both users', async () => {
    const yesBuyer = await signupUser(app);
    const noBuyer = await signupUser(app);
    const marketId = await makeOpenMarket();

    // yesBuyer rests a BUY YES @ 60¢
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(yesBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 5 },
    });
    // noBuyer comes in BUY NO @ 40¢ — should cross-match (60 + 40 = 100)
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(noBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { order: { status: string }; fills: unknown[] };
    expect(body.order.status).toBe('FILLED');
    // Cross trade produces two Trade rows (one per outcome)
    expect(body.fills).toHaveLength(2);

    const yesPos = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: yesBuyer.id, marketId } },
    });
    const noPos = await prisma.position.findUniqueOrThrow({
      where: { userId_marketId: { userId: noBuyer.id, marketId } },
    });
    expect(yesPos.yesShares).toBe(5);
    expect(noPos.noShares).toBe(5);

    // Both wallets paid their bid prices, no reservation left
    const yesWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: yesBuyer.id } });
    const noWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: noBuyer.id } });
    expect(yesWallet.balance).toBe(100_000 - 60 * 5);
    expect(yesWallet.reserved).toBe(0);
    expect(noWallet.balance).toBe(100_000 - 40 * 5);
    expect(noWallet.reserved).toBe(0);
  });
});
