import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@crossbar/db';
import { computeEquitySeries } from './equity.js';
import {
  bearer,
  makeApp,
  makeOpenMarket,
  signupUser,
} from '../test-helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

describe('computeEquitySeries', () => {
  it('returns flat 100,000¢ for a brand new user with no trades', async () => {
    const user = await signupUser(app);
    const result = await computeEquitySeries(prisma, user.id, 168);

    expect(result.points.length).toBeGreaterThanOrEqual(2);
    for (const p of result.points) {
      expect(p.equity).toBe(100_000);
    }
  });

  it('tracks equity through a buy-and-mark-to-market sequence', async () => {
    const user = await signupUser(app);
    const counterparty = await signupUser(app);
    const marketId = await makeOpenMarket();

    // user buys 10 YES @ 60¢ (crosses with counterparty NO @ 40¢)
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(counterparty.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 },
    });

    const result = await computeEquitySeries(prisma, user.id, 168);
    expect(result.points.length).toBeGreaterThanOrEqual(2);

    // Starting equity ≈ 100,000¢ (cash only, before the trade); ending equity
    // ≈ cash 99,400 + 10 YES * 60¢ mark = 100,000¢ (no P&L change yet since
    // last trade *is* the user's own fill).
    const start = result.points[0]!;
    const end = result.points[result.points.length - 1]!;
    expect(start.equity).toBe(100_000);
    expect(end.equity).toBe(100_000);
  });

  it('counts profit when mark price moves above cost basis', async () => {
    const user = await signupUser(app);
    const counterparty = await signupUser(app);
    const seller = await signupUser(app);
    const marketId = await makeOpenMarket();

    // Mint a YES + NO pair so seller holds 10 YES that they can sell.
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(seller.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(counterparty.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 50, quantity: 10 },
    });
    // seller rests a SELL @ 60¢
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(seller.token),
      payload: { marketId, side: 'SELL', outcome: 'YES', price: 60, quantity: 10 },
    });
    // user hits it: now user holds 10 YES @ avg cost 60¢
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 },
    });
    // Final trade prints at 70¢ to bump the mark.
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(seller.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 70, quantity: 1 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(counterparty.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 30, quantity: 1 },
    });

    const result = await computeEquitySeries(prisma, user.id, 168);
    const end = result.points[result.points.length - 1]!;
    // user: cash 100_000 - 60*10 = 99_400; +10 YES marked at 70¢ = 700¢
    // → 99_400 + 700 = 100_100¢
    expect(end.equity).toBe(100_100);
  });
});
