import type { FastifyInstance } from 'fastify';
import {
  CalibrationLearner,
  runBacktest,
  type BacktestResult,
  type BacktestSummary,
} from '@crossbar/bots';
import { prisma } from '../lib/prisma.js';

const BOT_USERNAMES = [
  'bot_house',
  'bot_pinnacle',
  'bot_adaptive',
  'bot_contrarian',
  'bot_momentum',
  'bot_random',
];

/**
 * Recompute the learner state from scratch by replaying all resolved markets
 * in resolution order. Cached briefly so a Polling /bots/learner endpoint
 * doesn't hammer Postgres on every request.
 */
const LEARNER_TTL_MS = 60_000;
let learnerCache: { at: number; snapshot: ReturnType<CalibrationLearner['snapshot']> } | null = null;
async function getLearnerSnapshot(): Promise<ReturnType<CalibrationLearner['snapshot']>> {
  if (learnerCache && Date.now() - learnerCache.at < LEARNER_TTL_MS) {
    return learnerCache.snapshot;
  }
  const learner = new CalibrationLearner();
  await learner.refreshFromDb(prisma);
  const snapshot = learner.snapshot();
  learnerCache = { at: Date.now(), snapshot };
  return snapshot;
}

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
  fastify.get('/bots/learner', async () => {
    return getLearnerSnapshot();
  });

  fastify.get<{ Querystring: { days?: string } }>('/bots/daily-accuracy', async (req) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
    return getDailyAccuracy(days);
  });

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

// ─── Daily accuracy (platform + per-bot) ──────────────────────────────────

interface DayCell {
  resolved: number;
  correct: number;
}
interface DailyRow {
  date: string;
  platformAccuracy: number | null;
  platformResolved: number;
  bots: Record<string, { accuracy: number | null; resolved: number }>;
}
interface DailyAccuracyResult {
  windowDays: number;
  bots: string[];
  days: DailyRow[];
}

const DAILY_TTL_MS = 5 * 60_000;
const dailyCache = new Map<number, { at: number; value: DailyAccuracyResult }>();

async function getDailyAccuracy(days: number): Promise<DailyAccuracyResult> {
  const cached = dailyCache.get(days);
  if (cached && Date.now() - cached.at < DAILY_TTL_MS) return cached.value;
  const value = await computeDailyAccuracy(days);
  dailyCache.set(days, { at: Date.now(), value });
  return value;
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

async function computeDailyAccuracy(days: number): Promise<DailyAccuracyResult> {
  const since = new Date(Date.now() - days * 24 * 3600_000);

  const [markets, bots] = await Promise.all([
    prisma.market.findMany({
      where: { status: 'RESOLVED', outcome: { in: ['YES', 'NO'] }, resolvedAt: { gte: since } },
      select: { id: true, outcome: true, closedAt: true, resolvedAt: true },
    }),
    prisma.user.findMany({
      where: { username: { in: BOT_USERNAMES } },
      select: { id: true, username: true },
    }),
  ]);

  const botName = new Map(bots.map((b) => [b.id, b.username]));
  const presentBots = bots.map((b) => b.username).sort();

  // Per-bot positions on the resolved markets in scope.
  const positions = markets.length
    ? await prisma.position.findMany({
        where: { userId: { in: bots.map((b) => b.id) }, marketId: { in: markets.map((m) => m.id) } },
        select: {
          userId: true,
          marketId: true,
          avgYesCost: true,
          avgNoCost: true,
          yesShares: true,
          noShares: true,
        },
      })
    : [];
  const posByMarket = new Map<string, typeof positions>();
  for (const p of positions) {
    const arr = posByMarket.get(p.marketId) ?? [];
    arr.push(p);
    posByMarket.set(p.marketId, arr);
  }

  // date → platform cell + per-bot cells
  const platform = new Map<string, DayCell>();
  const perBot = new Map<string, Map<string, DayCell>>(); // date → username → cell

  const bump = (m: Map<string, DayCell>, key: string, correct: boolean): void => {
    const cell = m.get(key) ?? { resolved: 0, correct: 0 };
    cell.resolved += 1;
    if (correct) cell.correct += 1;
    m.set(key, cell);
  };

  for (const market of markets) {
    if (!market.resolvedAt) continue;
    const date = dayKey(market.resolvedAt);
    const wasYes = market.outcome === 'YES';

    // Platform "prediction" = closing YES price (last trade before close).
    const lastTrade = await prisma.trade.findFirst({
      where: { marketId: market.id, ...(market.closedAt ? { createdAt: { lte: market.closedAt } } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { price: true, outcome: true },
    });
    if (lastTrade) {
      const yesClose = lastTrade.outcome === 'YES' ? lastTrade.price : 100 - lastTrade.price;
      bump(platform, date, yesClose > 50 === wasYes);
    }

    // Each bot that held a position with a derivable directional view.
    for (const p of posByMarket.get(market.id) ?? []) {
      const pred = predictionCents(p);
      if (pred == null || pred === 50) continue;
      const name = botName.get(p.userId);
      if (!name) continue;
      const m = perBot.get(date) ?? new Map<string, DayCell>();
      bump(m, name, pred > 50 === wasYes);
      perBot.set(date, m);
    }
  }

  // Assemble rows newest-first across the union of dates seen.
  const dates = new Set<string>([...platform.keys(), ...perBot.keys()]);
  const rows: DailyRow[] = [...dates]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((date) => {
      const pf = platform.get(date);
      const botCells = perBot.get(date) ?? new Map<string, DayCell>();
      const botsOut: DailyRow['bots'] = {};
      for (const name of presentBots) {
        const c = botCells.get(name);
        botsOut[name] = {
          resolved: c?.resolved ?? 0,
          accuracy: c && c.resolved > 0 ? c.correct / c.resolved : null,
        };
      }
      return {
        date,
        platformResolved: pf?.resolved ?? 0,
        platformAccuracy: pf && pf.resolved > 0 ? pf.correct / pf.resolved : null,
        bots: botsOut,
      };
    });

  return { windowDays: days, bots: presentBots, days: rows };
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
