import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { prisma } from '@crossbar/db';
import { runMatcher, STREAM, type MatcherHandle } from './index.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let redis: Redis;
let matcher: MatcherHandle;

beforeEach(async () => {
  redis = new Redis(REDIS_URL);
  matcher = await runMatcher({
    redisUrl: REDIS_URL,
    consumerName: `matcher-test-${process.pid}`,
    resetStream: true,
    silent: true,
  });
});

afterEach(async () => {
  await matcher.stop();
  redis.disconnect();
});

interface SeededUser {
  userId: string;
}

async function seedMarket(): Promise<string> {
  await prisma.sport.upsert({ where: { id: 'mlb' }, update: {}, create: { id: 'mlb', name: 'MLB' } });
  const event = await prisma.event.create({
    data: {
      sportId: 'mlb',
      externalId: `evt-${Date.now()}-${Math.random()}`,
      homeTeam: 'HOME',
      awayTeam: 'AWAY',
      startsAt: new Date(Date.now() + 3600_000),
    },
  });
  const market = await prisma.market.create({
    data: {
      eventId: event.id,
      type: 'MONEYLINE',
      question: 'Will HOME beat AWAY?',
      yesLabel: 'HOME',
      noLabel: 'AWAY',
    },
  });
  return market.id;
}

async function seedUser(suffix: string): Promise<SeededUser> {
  const user = await prisma.user.create({
    data: {
      email: `m-${suffix}-${Math.random()}@test.local`,
      username: `m_${suffix}_${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: 'x',
      wallet: { create: {} },
    },
  });
  return { userId: user.id };
}

/** XADD a request and BLPOP its reply (mirrors the API matcher-client). */
async function rpc(
  action: string,
  userId: string,
  payload: unknown,
  timeoutSec = 5,
): Promise<{ status: string; data?: unknown; error?: { code: string } }> {
  const requestId = `req-${Math.random().toString(36).slice(2)}`;
  await redis.xadd(
    STREAM,
    '*',
    'requestId',
    requestId,
    'action',
    action,
    'userId',
    userId,
    'payload',
    JSON.stringify(payload),
  );
  const blocking = redis.duplicate();
  try {
    const res = await blocking.blpop(`orders:result:${requestId}`, timeoutSec);
    if (!res) throw new Error('no reply');
    return JSON.parse(res[1]);
  } finally {
    blocking.disconnect();
  }
}

describe('matcher consumer loop', () => {
  it('consumes a place_order from the stream and writes a reply', async () => {
    const marketId = await seedMarket();
    const { userId } = await seedUser('buyer');

    const reply = await rpc('place_order', userId, {
      marketId,
      side: 'BUY',
      outcome: 'YES',
      price: 50,
      quantity: 10,
    });

    expect(reply.status).toBe('ok');
    const data = reply.data as { order: { status: string; price: number }; fills: unknown[] };
    expect(data.order.status).toBe('OPEN');
    expect(data.order.price).toBe(50);
    expect(data.fills).toHaveLength(0);

    // Funds reserved exactly once.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.reserved).toBe(500);
  });

  it('cross-matches two buys into a minted pair', async () => {
    const marketId = await seedMarket();
    const yes = await seedUser('yes');
    const no = await seedUser('no');

    await rpc('place_order', yes.userId, {
      marketId,
      side: 'BUY',
      outcome: 'YES',
      price: 60,
      quantity: 5,
    });
    const reply = await rpc('place_order', no.userId, {
      marketId,
      side: 'BUY',
      outcome: 'NO',
      price: 40,
      quantity: 5,
    });

    expect(reply.status).toBe('ok');
    const data = reply.data as { order: { status: string }; fills: unknown[] };
    expect(data.order.status).toBe('FILLED');
    expect(data.fills).toHaveLength(2);
  });

  it('is idempotent: the same requestId settles exactly once', async () => {
    const marketId = await seedMarket();
    const { userId } = await seedUser('idem');

    const requestId = `dup-${Math.random().toString(36).slice(2)}`;
    const payload = { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 };

    // Two stream entries carrying the SAME requestId — a redelivery.
    for (let i = 0; i < 2; i++) {
      await redis.xadd(
        STREAM,
        '*',
        'requestId',
        requestId,
        'action',
        'place_order',
        'userId',
        userId,
        'payload',
        JSON.stringify(payload),
      );
    }

    // First entry replies; the second is deduped and produces no reply.
    const blocking = redis.duplicate();
    const res = await blocking.blpop(`orders:result:${requestId}`, 5);
    blocking.disconnect();
    expect(res).not.toBeNull();

    // Give the loop a moment to (not) process the duplicate.
    await new Promise((r) => setTimeout(r, 200));

    const orders = await prisma.order.count({ where: { userId } });
    expect(orders).toBe(1);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.reserved).toBe(500); // reserved once, not twice
  });

  it('cancel_order releases reserved funds', async () => {
    const marketId = await seedMarket();
    const { userId } = await seedUser('canceller');

    const placed = await rpc('place_order', userId, {
      marketId,
      side: 'BUY',
      outcome: 'YES',
      price: 50,
      quantity: 10,
    });
    const orderId = (placed.data as { order: { id: string } }).order.id;

    const cancel = await rpc('cancel_order', userId, { orderId });
    expect(cancel.status).toBe('ok');
    expect((cancel.data as { order: { status: string } }).order.status).toBe('CANCELED');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.balance).toBe(100_000);
    expect(wallet.reserved).toBe(0);
  });

  it('resolve_market pays out YES holders and clears the book snapshot', async () => {
    const marketId = await seedMarket();
    const yes = await seedUser('ryes');
    const no = await seedUser('rno');

    await rpc('place_order', yes.userId, { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 10 });
    await rpc('place_order', no.userId, { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 10 });

    const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: yes.userId } });

    const reply = await rpc('resolve_market', 'system', { marketId, outcome: 'YES' });
    expect(reply.status).toBe('ok');

    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: yes.userId } });
    expect(after.balance).toBe(before.balance + 10 * 100);

    // Book snapshot key is now an empty book.
    const snap = await redis.get(`market:${marketId}:book:snapshot`);
    const parsed = JSON.parse(snap ?? '{}') as { yesBids: unknown[]; noBids: unknown[] };
    expect(parsed.yesBids).toHaveLength(0);
    expect(parsed.noBids).toHaveLength(0);
  });

  it('close_market cancels resting orders and refunds the buyer', async () => {
    const marketId = await seedMarket();
    const { userId } = await seedUser('closer');

    await rpc('place_order', userId, { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 });
    const reply = await rpc('close_market', 'system', { marketId });
    expect(reply.status).toBe('ok');
    expect((reply.data as { canceledOrderIds: string[] }).canceledOrderIds).toHaveLength(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.balance).toBe(100_000);
    expect(wallet.reserved).toBe(0);
  });

  it('create_market creates a tradeable market', async () => {
    await prisma.sport.upsert({ where: { id: 'nba' }, update: {}, create: { id: 'nba', name: 'NBA' } });
    const event = await prisma.event.create({
      data: {
        sportId: 'nba',
        externalId: `evt-create-${Math.random()}`,
        homeTeam: 'H',
        awayTeam: 'A',
        startsAt: new Date(Date.now() + 3600_000),
      },
    });

    const reply = await rpc('create_market', 'system', {
      eventId: event.id,
      type: 'TOTAL',
      line: 47.5,
    });
    expect(reply.status).toBe('ok');
    const market = (reply.data as { market: { id: string; type: string; line: number } }).market;
    expect(market.type).toBe('TOTAL');
    expect(market.line).toBe(47.5);
  });

  it('replies with an error for an order on a non-open market', async () => {
    const marketId = await seedMarket();
    await prisma.market.update({ where: { id: marketId }, data: { status: 'CLOSED' } });
    const { userId } = await seedUser('rejected');

    const reply = await rpc('place_order', userId, {
      marketId,
      side: 'BUY',
      outcome: 'YES',
      price: 50,
      quantity: 10,
    });
    expect(reply.status).toBe('error');
    expect(reply.error?.code).toBe('MARKET_NOT_OPEN');
  });

  it('crash recovery: redelivery after a crash between handle and ACK dedups', async () => {
    const marketId = await seedMarket();
    const { userId } = await seedUser('crash');

    const entry = {
      requestId: `crash-${Math.random().toString(36).slice(2)}`,
      action: 'place_order' as const,
      userId,
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 50, quantity: 10 },
    };

    // First handling succeeds; imagine the matcher crashed before XACK.
    await matcher.handle(entry);
    // XREADGROUP redelivers the same message → handle runs again.
    await matcher.handle(entry);

    const orders = await prisma.order.count({ where: { userId } });
    expect(orders).toBe(1);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.reserved).toBe(500);
  });
});
