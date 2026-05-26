import { fairValueFor } from './fair-value.js';
import { houseMaker } from './strategies/house-maker.js';
import { pinnacle } from './strategies/pinnacle.js';
import { contrarian } from './strategies/contrarian.js';
import { momentum } from './strategies/momentum.js';
import { random } from './strategies/random.js';
import type { Bot, MarketContext } from './types.js';

export const BOTS: Bot[] = [houseMaker, pinnacle, contrarian, momentum, random];

export interface CalibrationBin {
  bin: number;
  predicted: number;
  actual: number;
  count: number;
  wins: number;
}

export interface BacktestResult {
  bot: string;
  predictions: number;
  correct: number;
  accuracy: number; // 0..1
  brierScore: number; // 0..1
  pnlCents: number;
  calibration: CalibrationBin[];
}

export interface BacktestSummary {
  events: number;
  seed: number;
  generatedAt: string;
  results: BacktestResult[];
}

interface SimEvent {
  sportId: string;
  homeMoneyLine: number;
  awayMoneyLine: number;
  spread: number;
  trueProb: number;
  homeWon: boolean;
}

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 0xffffffff;
  };
}

function clip(p: number): number {
  return Math.max(0.02, Math.min(0.98, p));
}

function probToAmerican(p: number): number {
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

function sportSpread(sportId: string, trueProb: number, rand: () => number): number {
  const k: Record<string, number> = { nfl: 4.5, nba: 5.5, mlb: 1.3, nhl: 1.5 };
  const scale = k[sportId] ?? 4;
  const spread = -scale * Math.log(trueProb / (1 - trueProb));
  return Math.round((spread + (rand() - 0.5)) * 2) / 2;
}

function generateEvents(n: number, rand: () => number): SimEvent[] {
  const sports = ['mlb', 'nfl', 'nba', 'nhl'];
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    const sportId = sports[Math.floor(rand() * sports.length)]!;
    const trueProb = 0.25 + rand() * 0.5;
    const vig = 0.04;
    const homeProbVig = trueProb * (1 + vig / 2);
    const awayProbVig = (1 - trueProb) * (1 + vig / 2);
    const noise = (rand() - 0.5) * 0.06;
    out.push({
      sportId,
      homeMoneyLine: probToAmerican(clip(homeProbVig + noise)),
      awayMoneyLine: probToAmerican(clip(awayProbVig - noise)),
      spread: sportSpread(sportId, trueProb, rand),
      trueProb,
      homeWon: rand() < trueProb,
    });
  }
  return out;
}

interface BotCall {
  direction: 'YES' | 'NO' | null;
  confidence: number;
}

function botCall(bot: Bot, ctx: MarketContext): BotCall | null {
  const orders = bot.decide(ctx);
  if (orders.length === 0) return null;

  let yesNotional = 0;
  let noNotional = 0;
  let yesPriceSum = 0;
  let noPriceSum = 0;
  let yesQty = 0;
  let noQty = 0;
  for (const o of orders) {
    if (o.side !== 'BUY') continue;
    if (o.outcome === 'YES') {
      yesNotional += o.quantity * o.price;
      yesPriceSum += o.price * o.quantity;
      yesQty += o.quantity;
    } else {
      noNotional += o.quantity * o.price;
      noPriceSum += o.price * o.quantity;
      noQty += o.quantity;
    }
  }
  if (yesNotional === 0 && noNotional === 0) return null;
  if (Math.abs(yesNotional - noNotional) < Math.max(yesNotional, noNotional) * 0.1) {
    return { direction: null, confidence: 50 };
  }
  if (yesNotional > noNotional) {
    return { direction: 'YES', confidence: Math.round(yesPriceSum / yesQty) };
  }
  return { direction: 'NO', confidence: Math.round(noPriceSum / noQty) };
}

function emptyResult(name: string): BacktestResult {
  return {
    bot: name,
    predictions: 0,
    correct: 0,
    accuracy: 0,
    brierScore: 0,
    pnlCents: 0,
    calibration: Array.from({ length: 10 }, (_, i) => ({
      bin: i,
      predicted: i * 10 + 5,
      actual: 0,
      count: 0,
      wins: 0,
    })),
  };
}

/**
 * Synthetic-outcome Monte Carlo backtest. N events, deterministic seed.
 * Returns per-bot accuracy + Brier + PnL + 10-bin calibration.
 *
 * Pure function: no I/O, no DB. Used both by the maker CLI and by the API
 * stats endpoint (cached) to display calibration data before real games
 * resolve.
 */
export function runBacktest(events = 200, seed = 42): BacktestSummary {
  const rand = rng(seed);
  const evts = generateEvents(events, rand);
  const results = new Map<string, BacktestResult>();
  let brierSums = new Map<string, number>();
  for (const b of BOTS) {
    results.set(b.name, emptyResult(b.name));
    brierSums.set(b.name, 0);
  }

  evts.forEach((ev, i) => {
    const marketId = `sim-${i}`;
    const eventStub = {
      id: `sim-evt-${i}`,
      sportId: ev.sportId,
      startsAt: new Date(Date.now() + 3600_000),
      status: 'SCHEDULED' as const,
      spread: ev.spread,
      overUnder: null,
      homeMoneyLine: ev.homeMoneyLine,
      awayMoneyLine: ev.awayMoneyLine,
      homeTeam: 'Home',
      awayTeam: 'Away',
    };

    // Synthesize a brief trade history that random-walks toward truth.
    const target = ev.trueProb * 100;
    let p = 50 + (rand() - 0.5) * 20;
    const trades: Array<{ outcome: 'YES' | 'NO'; price: number; quantity: number; createdAt: string }> = [];
    for (let k = 0; k < 6; k++) {
      p = p * 0.6 + target * 0.4 + (rand() - 0.5) * 6;
      const px = Math.max(2, Math.min(98, Math.round(p)));
      trades.push({
        outcome: 'YES',
        price: px,
        quantity: 10,
        createdAt: new Date(Date.now() - (5 - k) * 60_000).toISOString(),
      });
    }
    trades.reverse(); // newest-first

    const fair = fairValueFor({ type: 'MONEYLINE', line: null }, eventStub);
    const ctx: MarketContext = {
      market: {
        id: marketId,
        type: 'MONEYLINE',
        line: null,
        status: 'OPEN',
        topOfBook: {
          yesBid: trades[trades.length - 1]!.price - 1,
          yesAsk: trades[trades.length - 1]!.price + 1,
          noBid: 100 - trades[trades.length - 1]!.price - 1,
          noAsk: 100 - trades[trades.length - 1]!.price + 1,
        },
        lastTradePrice: trades[trades.length - 1]!.price,
      },
      event: eventStub,
      recentTrades: trades,
      fairYes: fair.yesCents,
      fairConfidence: fair.confidence,
    };

    for (const bot of BOTS) {
      const call = botCall(bot, ctx);
      if (!call || call.direction == null) continue;
      const r = results.get(bot.name)!;
      const wasYes = ev.homeWon;
      const correct =
        (call.direction === 'YES' && wasYes) || (call.direction === 'NO' && !wasYes);
      r.predictions += 1;
      if (correct) r.correct += 1;
      const impliedYes = call.direction === 'YES' ? call.confidence : 100 - call.confidence;
      const err = (impliedYes - (wasYes ? 100 : 0)) / 100;
      brierSums.set(bot.name, (brierSums.get(bot.name) ?? 0) + err * err);
      r.pnlCents += correct ? 100 - call.confidence : -call.confidence;

      const binIdx = Math.min(9, Math.floor(impliedYes / 10));
      const cb = r.calibration[binIdx]!;
      cb.count += 1;
      if (wasYes) cb.wins += 1;
    }
  });

  for (const r of results.values()) {
    r.accuracy = r.predictions > 0 ? r.correct / r.predictions : 0;
    r.brierScore = r.predictions > 0 ? (brierSums.get(r.bot) ?? 0) / r.predictions : 0;
    for (const c of r.calibration) {
      c.actual = c.count > 0 ? Math.round((c.wins / c.count) * 100) : 0;
    }
    r.calibration = r.calibration.filter((c) => c.count > 0);
  }

  return {
    events,
    seed,
    generatedAt: new Date().toISOString(),
    results: [...results.values()],
  };
}
