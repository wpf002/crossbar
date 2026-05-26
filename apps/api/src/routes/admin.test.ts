import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@crossbar/db';
import {
  bearer,
  makeAdminUser,
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

describe('/admin auth gate', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const user = await signupUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/stats',
      headers: bearer(user.token),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('returns 200 for an admin user', async () => {
    const admin = await makeAdminUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/stats',
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      marketsByStatus: expect.any(Object),
      userCount: expect.any(Number),
    });
  });
});

describe('POST /admin/markets', () => {
  it('creates a custom market on an existing event', async () => {
    const admin = await makeAdminUser(app);

    await prisma.sport.upsert({
      where: { id: 'nfl' },
      update: {},
      create: { id: 'nfl', name: 'NFL' },
    });
    const event = await prisma.event.create({
      data: {
        sportId: 'nfl',
        externalId: 'evt-admin-1',
        homeTeam: 'A',
        awayTeam: 'B',
        startsAt: new Date(Date.now() + 3600_000),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/markets',
      headers: bearer(admin.token),
      payload: {
        eventId: event.id,
        type: 'TOTAL',
        line: 47.5,
        question: 'Will combined points be OVER 47.5?',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { market: { id: string; type: string; line: number } };
    expect(body.market.type).toBe('TOTAL');
    expect(body.market.line).toBe(47.5);
  });
});

describe('POST /admin/markets/:id/resolve', () => {
  it('credits YES holders when resolved YES', async () => {
    const admin = await makeAdminUser(app);
    const yesBuyer = await signupUser(app);
    const noBuyer = await signupUser(app);
    const marketId = await makeOpenMarket();

    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(yesBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(noBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 },
    });

    const yesWalletBefore = await prisma.wallet.findUniqueOrThrow({
      where: { userId: yesBuyer.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/markets/${marketId}/resolve`,
      headers: bearer(admin.token),
      payload: { outcome: 'YES' },
    });
    expect(res.statusCode).toBe(200);

    const yesWalletAfter = await prisma.wallet.findUniqueOrThrow({
      where: { userId: yesBuyer.id },
    });
    // 10 YES shares paid out at 100¢ each.
    expect(yesWalletAfter.balance).toBe(yesWalletBefore.balance + 10 * 100);
  });
});

describe('POST /admin/markets/:id/void', () => {
  it('refunds cost basis on void', async () => {
    const admin = await makeAdminUser(app);
    const yesBuyer = await signupUser(app);
    const noBuyer = await signupUser(app);
    const marketId = await makeOpenMarket();

    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(yesBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(noBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 },
    });

    const yesBefore = await prisma.wallet.findUniqueOrThrow({
      where: { userId: yesBuyer.id },
    });
    const noBefore = await prisma.wallet.findUniqueOrThrow({
      where: { userId: noBuyer.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/markets/${marketId}/void`,
      headers: bearer(admin.token),
      payload: { reason: 'event canceled' },
    });
    expect(res.statusCode).toBe(200);

    const yesAfter = await prisma.wallet.findUniqueOrThrow({
      where: { userId: yesBuyer.id },
    });
    const noAfter = await prisma.wallet.findUniqueOrThrow({
      where: { userId: noBuyer.id },
    });
    // 10 YES shares @ 60¢ = 600¢ refund; 10 NO shares @ 40¢ = 400¢ refund
    expect(yesAfter.balance).toBe(yesBefore.balance + 600);
    expect(noAfter.balance).toBe(noBefore.balance + 400);
  });
});

describe('POST /admin/events/:id/finalize', () => {
  it('finalizes the event and resolves attached markets', async () => {
    const admin = await makeAdminUser(app);
    const yesBuyer = await signupUser(app);
    const noBuyer = await signupUser(app);

    await prisma.sport.upsert({
      where: { id: 'nba' },
      update: {},
      create: { id: 'nba', name: 'NBA' },
    });
    const event = await prisma.event.create({
      data: {
        sportId: 'nba',
        externalId: `evt-fin-${Date.now()}`,
        homeTeam: 'HOME',
        awayTeam: 'AWAY',
        startsAt: new Date(Date.now() + 3600_000),
      },
    });
    const market = await prisma.market.create({
      data: {
        eventId: event.id,
        type: 'MONEYLINE',
        question: 'home wins?',
        yesLabel: 'home',
        noLabel: 'away',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(yesBuyer.token),
      payload: {
        marketId: market.id,
        side: 'BUY',
        outcome: 'YES',
        price: 55,
        quantity: 10,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(noBuyer.token),
      payload: {
        marketId: market.id,
        side: 'BUY',
        outcome: 'NO',
        price: 45,
        quantity: 10,
      },
    });

    const yesBefore = await prisma.wallet.findUniqueOrThrow({
      where: { userId: yesBuyer.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/finalize`,
      headers: bearer(admin.token),
      payload: { homeScore: 110, awayScore: 100 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      event: { homeScore: number; awayScore: number };
      resolved: Array<{ marketId: string; outcome: string }>;
    };
    expect(body.event.homeScore).toBe(110);
    expect(body.resolved).toHaveLength(1);
    expect(body.resolved[0]!.outcome).toBe('YES');

    const yesAfter = await prisma.wallet.findUniqueOrThrow({
      where: { userId: yesBuyer.id },
    });
    // YES won, 10 shares paid at 100¢
    expect(yesAfter.balance).toBe(yesBefore.balance + 10 * 100);
  });
});

describe('POST /admin/users/:id/topup', () => {
  it('adds to a user wallet', async () => {
    const admin = await makeAdminUser(app);
    const user = await signupUser(app);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/topup`,
      headers: bearer(admin.token),
      payload: { amount: 50_000 },
    });
    expect(res.statusCode).toBe(200);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(wallet.balance).toBe(150_000);
  });

  it('rejects a topup that would push balance negative', async () => {
    const admin = await makeAdminUser(app);
    const user = await signupUser(app);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/topup`,
      headers: bearer(admin.token),
      payload: { amount: -200_000 },
    });
    expect(res.statusCode).toBe(409);
  });
});
