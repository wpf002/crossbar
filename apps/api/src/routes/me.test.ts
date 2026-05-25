import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bearer, makeApp, makeOpenMarket, signupUser } from '../test-helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /me/wallet', () => {
  it('returns correct balance, reserved, and available after a BUY', async () => {
    const user = await signupUser(app);
    const marketId = await makeOpenMarket();

    let res = await app.inject({ method: 'GET', url: '/me/wallet', headers: bearer(user.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ balance: 100_000, reserved: 0, available: 100_000 });

    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 },
    });

    res = await app.inject({ method: 'GET', url: '/me/wallet', headers: bearer(user.token) });
    expect(res.json()).toMatchObject({ balance: 99_500, reserved: 500 });
  });
});

describe('GET /me/positions', () => {
  it('returns only the current user’s positions', async () => {
    const yesBuyer = await signupUser(app);
    const noBuyer = await signupUser(app);
    const onlooker = await signupUser(app);
    const marketId = await makeOpenMarket();

    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(yesBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 5 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(noBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 5 },
    });

    const yesRes = await app.inject({ method: 'GET', url: '/me/positions', headers: bearer(yesBuyer.token) });
    expect(yesRes.statusCode).toBe(200);
    const yesPositions = yesRes.json() as Array<{ yesShares: number; noShares: number }>;
    expect(yesPositions).toHaveLength(1);
    expect(yesPositions[0]!.yesShares).toBe(5);

    const onlookerRes = await app.inject({
      method: 'GET',
      url: '/me/positions',
      headers: bearer(onlooker.token),
    });
    expect(onlookerRes.json()).toEqual([]);
  });
});

describe('GET /me/trades', () => {
  it('returns only the current user’s trades', async () => {
    const yesBuyer = await signupUser(app);
    const noBuyer = await signupUser(app);
    const onlooker = await signupUser(app);
    const marketId = await makeOpenMarket();

    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(yesBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 1 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(noBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 1 },
    });

    const yesRes = await app.inject({ method: 'GET', url: '/me/trades', headers: bearer(yesBuyer.token) });
    const yesBody = yesRes.json() as { trades: unknown[] };
    expect(yesBody.trades.length).toBeGreaterThan(0);

    const onlookerRes = await app.inject({
      method: 'GET',
      url: '/me/trades',
      headers: bearer(onlooker.token),
    });
    expect(onlookerRes.json()).toMatchObject({ trades: [] });
  });
});
