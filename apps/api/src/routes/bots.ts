import type { FastifyInstance } from 'fastify';
import { runBacktest, type BacktestResult, type BacktestSummary } from '@crossbar/bots';
import { prisma } from '../lib/prisma.js';

const BOT_USERNAMES = [
  'bot_house',
  'bot_pinnacle',
  'bot_contrarian',
  'bot_momentum',
  'bot_random',
];

/**
 * Cache the simulated backtest in-memory. Recomputing 200-event Monte Carlo
 * is fast (~50ms) but pointless to redo every request. Refresh every 10 min.
 */
const BACKTEST_TTL_MS = 10 * 60_000;
let backtestCache: { at: number; result: BacktestSummary } | null = null;
function getBacktest(): BacktestSummary {
  if (backtestCache && Date.now() - backtestCache.at < BACKTEST_TTL_MS) {
    return backtestCache.result;
  }
  const result = runBacktest(200, 42);
  backtestCache = { at: Date.now(), result };
  return result;
}

/**
 * Per-bot accuracy stats. Two parallel views:
 *   - `live`      — derived from the bot's actual resolved positions in PG.
 *   - `simulated` — output of a 200-event synthetic Monte Carlo backtest run
 *                   server-side and cached. Available immediately even before
 *                   any real game has resolved.
 */
export default async function botsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/bots/stats', async () => {
    const bots = await prisma.user.findMany({
      where: { username: { in: BOT_USERNAMES } },
      select: { id: true, username: true },
    });

    const backtest = getBacktest();
    const simByBot = new Map(backtest.results.map((r) => [r.bot, r]));

    if (bots.length === 0) {
      return { bots: [], backtest: { events: backtest.events, generatedAt: backtest.generatedAt } };
    }

    const botIds = bots.map((b) => b.id);
    const [wallets, positions] = await Promise.all([
      prisma.wallet.findMany({ where: { userId: { in: botIds } } }),
      prisma.position.findMany({
        where: { userId: { in: botIds } },
        include: {
          market: {
            select: { id: true, type: true, status: true, outcome: true, question: true },
          },
        },
      }),
    ]);

    const walletByUser = new Map(wallets.map((w) => [w.userId, w]));
    const positionsByUser = new Map<string, typeof positions>();
    for (const p of positions) {
      const arr = positionsByUser.get(p.userId) ?? [];
      arr.push(p);
      positionsByUser.set(p.userId, arr);
    }

    const result = bots.map((b) => {
      const wallet = walletByUser.get(b.id);
      const myPositions = positionsByUser.get(b.id) ?? [];
      const resolved = myPositions.filter(
        (p) =>
          p.market.status === 'RESOLVED' &&
          (p.market.outcome === 'YES' || p.market.outcome === 'NO'),
      );

      let correct = 0;
      let total = 0;
      let brierSum = 0;
      const calibration: Array<{
        bin: number;
        predicted: number;
        actual: number;
        count: number;
        wins: number;
      }> = [];
      for (let i = 0; i < 10; i++) {
        calibration.push({ bin: i, predicted: i * 10 + 5, actual: 0, count: 0, wins: 0 });
      }

      for (const p of resolved) {
        const prediction = predictionCents(p);
        if (prediction == null) continue;
        const outcomeCents = p.market.outcome === 'YES' ? 100 : 0;
        const calledYes = prediction > 50;
        const wasYes = outcomeCents === 100;
        if ((calledYes && wasYes) || (!calledYes && !wasYes)) correct += 1;
        total += 1;
        const err = (prediction - outcomeCents) / 100;
        brierSum += err * err;
        const binIdx = Math.min(9, Math.floor(prediction / 10));
        const bin = calibration[binIdx]!;
        bin.count += 1;
        if (wasYes) bin.wins += 1;
      }
      for (const c of calibration) {
        c.actual = c.count > 0 ? Math.round((c.wins / c.count) * 100) : 0;
      }
      const realizedPnl = myPositions.reduce((a, p) => a + p.realizedPnl, 0);

      const sim = simByBot.get(b.username);
      return {
        username: b.username,
        userId: b.id,
        balance: wallet?.balance ?? 0,
        reserved: wallet?.reserved ?? 0,
        marketsTraded: myPositions.length,
        marketsResolved: resolved.length,
        correctCalls: correct,
        accuracy: total > 0 ? correct / total : null,
        brierScore: total > 0 ? brierSum / total : null,
        realizedPnl,
        calibration: calibration.filter((c) => c.count > 0),
        simulated: sim ? toSimPayload(sim) : null,
      };
    });

    return {
      bots: result,
      backtest: { events: backtest.events, generatedAt: backtest.generatedAt },
    };
  });
}

function toSimPayload(r: BacktestResult) {
  return {
    predictions: r.predictions,
    accuracy: r.accuracy,
    brierScore: r.brierScore,
    pnlCents: r.pnlCents,
    calibration: r.calibration,
  };
}

function predictionCents(p: {
  avgYesCost: number | null;
  avgNoCost: number | null;
  yesShares: number;
  noShares: number;
}): number | null {
  const yes = p.avgYesCost;
  const no = p.avgNoCost;
  if (yes == null && no == null) return null;
  if (yes != null && no == null) return yes;
  if (no != null && yes == null) return 100 - no;
  return yes ?? 50;
}
