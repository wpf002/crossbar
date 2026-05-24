/**
 * Manual smoke test for the matching engine. Wipes the dev DB, creates two
 * users + a MONEYLINE market, runs an ordered sequence of placeOrder calls,
 * and prints book/positions/wallets after each step.
 *
 *   pnpm --filter @crossbar/engine demo
 *   # or:  tsx packages/engine/scripts/demo.ts
 */
import { prisma } from '@crossbar/db';
import { placeOrder, type EngineContext } from '../src/index.js';
import { InsufficientPositionError } from '../src/errors.js';

async function main(): Promise<void> {
  console.log('\n=== Crossbar engine demo ===\n');

  await wipe();
  await prisma.sport.upsert({
    where: { id: 'mlb' },
    update: {},
    create: { id: 'mlb', name: 'Major League Baseball' },
  });

  const event = await prisma.event.create({
    data: {
      sportId: 'mlb',
      externalId: 'demo-event',
      homeTeam: 'BOS',
      awayTeam: 'NYY',
      startsAt: new Date(Date.now() + 24 * 3600_000),
    },
  });
  const market = await prisma.market.create({
    data: {
      eventId: event.id,
      type: 'MONEYLINE',
      question: 'Will BOS beat NYY?',
      yesLabel: 'BOS wins',
      noLabel: 'NYY wins',
    },
  });
  const [a, b] = await Promise.all([
    prisma.user.create({
      data: {
        email: 'alice@demo.local',
        username: 'alice',
        wallet: { create: {} },
      },
    }),
    prisma.user.create({
      data: { email: 'bob@demo.local', username: 'bob', wallet: { create: {} } },
    }),
  ]);

  console.log(`Created market ${market.id} (BOS vs NYY, MONEYLINE)`);
  console.log(`User A = ${a.username} (${a.id}), wallet $1000`);
  console.log(`User B = ${b.username} (${b.id}), wallet $1000`);

  const ctx: EngineContext = { prisma, books: new Map() };

  // ─── Step 1 ───────────────────────────────────────────────
  console.log('\n── Step 1: A: SELL YES @ 60 × 100 (no position — should reject)');
  try {
    await placeOrder(
      { marketId: market.id, side: 'SELL', outcome: 'YES', price: 60, quantity: 100 },
      a.id,
      ctx,
    );
    console.log('  UNEXPECTED: order accepted');
  } catch (err) {
    if (err instanceof InsufficientPositionError) {
      console.log(`  ✓ Rejected: ${err.message}`);
    } else {
      throw err;
    }
  }

  // ─── Step 2 ───────────────────────────────────────────────
  console.log('\n── Step 2: A: BUY YES @ 60 × 100 (rests; nothing to match)');
  const r2 = await placeOrder(
    { marketId: market.id, side: 'BUY', outcome: 'YES', price: 60, quantity: 100 },
    a.id,
    ctx,
  );
  console.log(
    `  order ${r2.order.id.slice(-6)} status=${r2.order.status} fills=${r2.fills.length}`,
  );
  await printState(market.id, [a.id, b.id]);

  // ─── Step 3 ───────────────────────────────────────────────
  console.log('\n── Step 3: B: BUY NO @ 40 × 50 (cross-match w/ A; 40+60=100, no improvement)');
  const r3 = await placeOrder(
    { marketId: market.id, side: 'BUY', outcome: 'NO', price: 40, quantity: 50 },
    b.id,
    ctx,
  );
  console.log(
    `  order ${r3.order.id.slice(-6)} status=${r3.order.status} fills=${r3.fills.length}`,
  );
  await printState(market.id, [a.id, b.id]);

  // ─── Step 4 ───────────────────────────────────────────────
  console.log(
    '\n── Step 4: B: BUY NO @ 50 × 50 (cross-match; A bid=60 wins, B exec=40, B saves 10/share)',
  );
  const r4 = await placeOrder(
    { marketId: market.id, side: 'BUY', outcome: 'NO', price: 50, quantity: 50 },
    b.id,
    ctx,
  );
  console.log(
    `  order ${r4.order.id.slice(-6)} status=${r4.order.status} fills=${r4.fills.length}`,
  );
  await printState(market.id, [a.id, b.id]);

  // ─── Step 5 ───────────────────────────────────────────────
  console.log('\n── Step 5: A: SELL YES @ 65 × 50 (rests; no resting bids ≥ 65)');
  const r5 = await placeOrder(
    { marketId: market.id, side: 'SELL', outcome: 'YES', price: 65, quantity: 50 },
    a.id,
    ctx,
  );
  console.log(
    `  order ${r5.order.id.slice(-6)} status=${r5.order.status} fills=${r5.fills.length}`,
  );
  await printState(market.id, [a.id, b.id]);

  // ─── Step 6 ───────────────────────────────────────────────
  console.log(
    '\n── Step 6: B: BUY YES @ 70 × 50 (direct match @ 65; B saves 5/share; A realizes P&L)',
  );
  const r6 = await placeOrder(
    { marketId: market.id, side: 'BUY', outcome: 'YES', price: 70, quantity: 50 },
    b.id,
    ctx,
  );
  console.log(
    `  order ${r6.order.id.slice(-6)} status=${r6.order.status} fills=${r6.fills.length}`,
  );
  await printState(market.id, [a.id, b.id]);

  console.log('\n=== Done ===\n');
  await prisma.$disconnect();
}

async function printState(marketId: string, userIds: string[]): Promise<void> {
  const openOrders = await prisma.order.findMany({
    where: { marketId, status: { in: ['OPEN', 'PARTIAL'] } },
    orderBy: [{ outcome: 'asc' }, { side: 'asc' }, { price: 'asc' }],
  });

  console.log('  Book (open orders):');
  if (openOrders.length === 0) console.log('    (empty)');
  for (const o of openOrders) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: o.userId } });
    console.log(
      `    ${u.username.padEnd(6)} ${o.side} ${o.outcome} @ ${o.price} × ${o.quantity - o.filled} (status=${o.status})`,
    );
  }

  console.log('  Wallets:');
  for (const uid of userIds) {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: uid } });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
    console.log(
      `    ${u.username.padEnd(6)} balance=${(w.balance / 100).toFixed(2)} reserved=${(w.reserved / 100).toFixed(2)} total=${((w.balance + w.reserved) / 100).toFixed(2)}`,
    );
  }

  console.log('  Positions:');
  for (const uid of userIds) {
    const p = await prisma.position.findUnique({
      where: { userId_marketId: { userId: uid, marketId } },
    });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
    if (!p) {
      console.log(`    ${u.username.padEnd(6)} (none)`);
      continue;
    }
    console.log(
      `    ${u.username.padEnd(6)} YES=${p.yesShares}@${p.avgYesCost ?? '-'}  NO=${p.noShares}@${p.avgNoCost ?? '-'}  realizedPnl=${p.realizedPnl}¢`,
    );
  }
}

async function wipe(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "TradeFill",
      "Trade",
      "Order",
      "Position",
      "Wallet",
      "Market",
      "Event",
      "Sport",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

main().catch((err: unknown) => {
  console.error('demo failed:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
