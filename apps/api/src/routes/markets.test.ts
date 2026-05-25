import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@crossbar/db';
import { bearer, makeApp, signupUser } from '../test-helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

async function seedSports() {
  await prisma.sport.upsert({ where: { id: 'mlb' }, update: {}, create: { id: 'mlb', name: 'MLB' } });
  await prisma.sport.upsert({ where: { id: 'nba' }, update: {}, create: { id: 'nba', name: 'NBA' } });
}

async function mkMarket(opts: { sportId: 'mlb' | 'nba'; type: 'MONEYLINE' | 'TOTAL' | 'SPREAD' }) {
  const event = await prisma.event.create({
    data: {
      sportId: opts.sportId,
      externalId: `evt-${opts.sportId}-${opts.type}-${Date.now()}-${Math.random()}`,
      homeTeam: 'H',
      awayTeam: 'A',
      startsAt: new Date(Date.now() + 3600_000),
    },
  });
  return prisma.market.create({
    data: {
      eventId: event.id,
      type: opts.type,
      question: `${opts.sportId} ${opts.type}?`,
      yesLabel: 'Y',
      noLabel: 'N',
      line: opts.type === 'MONEYLINE' ? null : 5.5,
    },
  });
}

describe('GET /markets', () => {
  it('filters by sport', async () => {
    await seedSports();
    await mkMarket({ sportId: 'mlb', type: 'MONEYLINE' });
    await mkMarket({ sportId: 'nba', type: 'MONEYLINE' });

    const res = await app.inject({ method: 'GET', url: '/markets?sport=mlb' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ event: { sportId: string } }>;
    expect(body.length).toBe(1);
    expect(body[0]!.event.sportId).toBe('mlb');
  });

  it('filters by type', async () => {
    await seedSports();
    await mkMarket({ sportId: 'mlb', type: 'MONEYLINE' });
    await mkMarket({ sportId: 'mlb', type: 'TOTAL' });

    const res = await app.inject({ method: 'GET', url: '/markets?type=TOTAL' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ type: string }>;
    expect(body.length).toBe(1);
    expect(body[0]!.type).toBe('TOTAL');
  });
});

describe('GET /markets/:id', () => {
  it('returns top-of-book after orders are placed', async () => {
    await seedSports();
    const market = await mkMarket({ sportId: 'mlb', type: 'MONEYLINE' });
    const user = await signupUser(app);

    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId: market.id, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 },
    });

    const res = await app.inject({ method: 'GET', url: `/markets/${market.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      topOfBook: { yesBid: number | null; yesAsk: number | null; noBid: number | null; noAsk: number | null };
    };
    expect(body.topOfBook.yesBid).toBe(60);
    expect(body.topOfBook.yesAsk).toBeNull();
  });
});

describe('GET /markets/:id/book', () => {
  it('returns up to 20 levels per side', async () => {
    await seedSports();
    const market = await mkMarket({ sportId: 'mlb', type: 'MONEYLINE' });

    // 25 distinct prices on YES bids — should be truncated to 20
    for (let i = 1; i <= 25; i++) {
      const user = await signupUser(app);
      await app.inject({
        method: 'POST',
        url: '/orders',
        headers: bearer(user.token),
        payload: { marketId: market.id, side: 'BUY', outcome: 'YES', price: i, quantity: 1 },
      });
    }

    const res = await app.inject({ method: 'GET', url: `/markets/${market.id}/book` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { yesBids: Array<{ price: number }> };
    expect(body.yesBids.length).toBeLessThanOrEqual(20);
  });
});

describe('GET /markets/:id/trades', () => {
  it('returns trades sorted descending by createdAt', async () => {
    await seedSports();
    const market = await mkMarket({ sportId: 'mlb', type: 'MONEYLINE' });
    const yesBuyer = await signupUser(app);
    const noBuyer = await signupUser(app);

    // Two cross-trades at different prices to create multiple trades
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(yesBuyer.token),
      payload: { marketId: market.id, side: 'BUY', outcome: 'YES', price: 60, quantity: 1 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(noBuyer.token),
      payload: { marketId: market.id, side: 'BUY', outcome: 'NO', price: 40, quantity: 1 },
    });

    const res = await app.inject({ method: 'GET', url: `/markets/${market.id}/trades` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { trades: Array<{ createdAt: string }> };
    expect(body.trades.length).toBeGreaterThan(0);
    for (let i = 1; i < body.trades.length; i++) {
      expect(new Date(body.trades[i - 1]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(body.trades[i]!.createdAt).getTime(),
      );
    }
  });
});
