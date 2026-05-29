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

  it('creates a PLAYER_TOTAL prop bound to a player + stat', async () => {
    const admin = await makeAdminUser(app);
    await prisma.sport.upsert({ where: { id: 'nfl' }, update: {}, create: { id: 'nfl', name: 'NFL' } });
    const event = await prisma.event.create({
      data: {
        sportId: 'nfl',
        externalId: 'evt-prop-1',
        homeTeam: 'A',
        awayTeam: 'B',
        startsAt: new Date(Date.now() + 3600_000),
      },
    });
    const player = await prisma.player.create({
      data: { sportId: 'nfl', externalId: 'ath-prop-1', name: 'Josh Allen', team: 'A', position: 'QB' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/markets',
      headers: bearer(admin.token),
      payload: {
        eventId: event.id,
        type: 'PLAYER_TOTAL',
        playerId: player.id,
        statKey: 'passingYards',
        line: 274.5,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { market: { id: string; type: string; line: number } };
    expect(body.market.type).toBe('PLAYER_TOTAL');

    const saved = await prisma.market.findUniqueOrThrow({ where: { id: body.market.id } });
    expect(saved.playerId).toBe(player.id);
    expect(saved.statKey).toBe('passingYards');
    expect(saved.question).toBe('Will Josh Allen record OVER 274.5 passing yards?');
  });

  it('rejects a PLAYER_TOTAL missing playerId/statKey', async () => {
    const admin = await makeAdminUser(app);
    await prisma.sport.upsert({ where: { id: 'nfl' }, update: {}, create: { id: 'nfl', name: 'NFL' } });
    const event = await prisma.event.create({
      data: {
        sportId: 'nfl',
        externalId: 'evt-prop-2',
        homeTeam: 'A',
        awayTeam: 'B',
        startsAt: new Date(Date.now() + 3600_000),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/markets',
      headers: bearer(admin.token),
      payload: { eventId: event.id, type: 'PLAYER_TOTAL', line: 274.5 },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /admin/props/catalog and /events/:id/players', () => {
  it('returns the prop catalog', async () => {
    const admin = await makeAdminUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/props/catalog',
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, { statKey: string }[]>;
    expect(body.nfl.some((p) => p.statKey === 'passingYards')).toBe(true);
  });

  it('lists players with recorded stats for an event', async () => {
    const admin = await makeAdminUser(app);
    await prisma.sport.upsert({ where: { id: 'nba' }, update: {}, create: { id: 'nba', name: 'NBA' } });
    const event = await prisma.event.create({
      data: {
        sportId: 'nba',
        externalId: 'evt-players-1',
        homeTeam: 'A',
        awayTeam: 'B',
        startsAt: new Date(Date.now() + 3600_000),
      },
    });
    const player = await prisma.player.create({
      data: { sportId: 'nba', externalId: 'ath-players-1', name: 'Jayson Tatum', team: 'A', position: 'SF' },
    });
    await prisma.playerStat.create({
      data: { eventId: event.id, playerId: player.id, stats: { points: 28, rebounds: 9 } },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/players`,
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { playerId: string; name: string; stats: Record<string, number> }[];
    expect(body).toHaveLength(1);
    expect(body[0]!.name).toBe('Jayson Tatum');
    expect(body[0]!.stats.points).toBe(28);
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

describe('GET /admin/calibration', () => {
  /** Create a resolved market with a known YES closing price + outcome. */
  async function resolvedMarket(opts: {
    yesClose: number;
    outcome: 'YES' | 'NO';
    buyerId: string;
    sellerId: string;
    resolvedAt?: Date;
  }): Promise<void> {
    await prisma.sport.upsert({ where: { id: 'mlb' }, update: {}, create: { id: 'mlb', name: 'MLB' } });
    const event = await prisma.event.create({
      data: {
        sportId: 'mlb',
        externalId: `evt-cal-${Date.now()}-${Math.random()}`,
        homeTeam: 'H',
        awayTeam: 'A',
        startsAt: new Date(Date.now() - 3 * 3600_000),
      },
    });
    const closedAt = opts.resolvedAt ?? new Date(Date.now() - 3600_000);
    const market = await prisma.market.create({
      data: {
        eventId: event.id,
        type: 'MONEYLINE',
        question: 'q',
        yesLabel: 'Y',
        noLabel: 'N',
        status: 'RESOLVED',
        outcome: opts.outcome,
        closedAt,
        resolvedAt: closedAt,
      },
    });
    // Closing trade: a YES trade at `yesClose`, just before the market closed.
    await prisma.trade.create({
      data: {
        marketId: market.id,
        outcome: 'YES',
        price: opts.yesClose,
        quantity: 1,
        buyerUserId: opts.buyerId,
        sellerUserId: opts.sellerId,
        createdAt: new Date(closedAt.getTime() - 60_000),
      },
    });
  }

  it('buckets markets and computes Brier + calibration error', async () => {
    const admin = await makeAdminUser(app);
    const buyer = await signupUser(app);
    const seller = await signupUser(app);

    // Bin 60-69 (midpoint 65): 4 markets close@65, 2 YES / 2 NO.
    for (let i = 0; i < 2; i++) {
      await resolvedMarket({ yesClose: 65, outcome: 'YES', buyerId: buyer.id, sellerId: seller.id });
      await resolvedMarket({ yesClose: 65, outcome: 'NO', buyerId: buyer.id, sellerId: seller.id });
    }
    // Bin 20-29 (midpoint 25): 4 markets close@25, 1 YES / 3 NO.
    await resolvedMarket({ yesClose: 25, outcome: 'YES', buyerId: buyer.id, sellerId: seller.id });
    for (let i = 0; i < 3; i++) {
      await resolvedMarket({ yesClose: 25, outcome: 'NO', buyerId: buyer.id, sellerId: seller.id });
    }

    // Unique days key avoids the 5-min in-memory cache colliding with other tests.
    const res = await app.inject({
      method: 'GET',
      url: '/admin/calibration?days=31',
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totalMarkets: number;
      brierScore: number;
      calibrationError: number;
      buckets: Array<{ bin: string; midpoint: number; sampleSize: number; actualYesProb: number; brierContrib: number }>;
    };

    expect(body.totalMarkets).toBe(8);
    // brierScore = (2·0.1225 + 2·0.4225 + 1·0.5625 + 3·0.0625) / 8 = 1.84/8 = 0.23
    expect(body.brierScore).toBeCloseTo(0.23, 4);
    // calibrationError = (4/8)|0.5-0.65| + (4/8)|0.25-0.25| = 0.075
    expect(body.calibrationError).toBeCloseTo(0.075, 4);

    expect(body.buckets).toHaveLength(2);
    const low = body.buckets.find((b) => b.bin === '20-29')!;
    const high = body.buckets.find((b) => b.bin === '60-69')!;
    expect(low.sampleSize).toBe(4);
    expect(low.midpoint).toBe(25);
    expect(low.actualYesProb).toBeCloseTo(0.25, 4);
    expect(high.sampleSize).toBe(4);
    expect(high.midpoint).toBe(65);
    expect(high.actualYesProb).toBeCloseTo(0.5, 4);
  });

  it('returns 403 for a non-admin', async () => {
    const user = await signupUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/calibration',
      headers: bearer(user.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns zero markets and null Brier for an empty window', async () => {
    const admin = await makeAdminUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/calibration?days=17',
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { totalMarkets: number; brierScore: number | null };
    expect(body.totalMarkets).toBe(0);
    expect(body.brierScore).toBeNull();
  });
});
