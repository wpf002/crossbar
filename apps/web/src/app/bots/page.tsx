'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Bot as BotIcon, LineChart as LineChartIcon, Target } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import { formatDollars } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { BotCalibrationBin, BotSimulatedStat, BotStat, DailyAccuracyRow } from '@/lib/types';

const SERIES_COLORS: Record<string, string> = {
  platform: '#e2e8f0',
  bot_house: '#22d3ee',
  bot_pinnacle: '#a78bfa',
  bot_adaptive: '#34d399',
  bot_contrarian: '#f472b6',
  bot_momentum: '#fbbf24',
  bot_random: '#94a3b8',
};
const seriesColor = (key: string): string => SERIES_COLORS[key] ?? '#64748b';
const seriesLabel = (key: string): string => (key === 'platform' ? 'Platform' : `@${key}`);

const BOT_BLURBS: Record<string, string> = {
  bot_house:
    'Tier 1 — symmetric BUY YES + BUY NO around ESPN-implied fair value. Quotes both sides; profits on the spread.',
  bot_pinnacle:
    'Tier 2 — trusts the de-vigged ESPN moneyline. Attacks mispricings, otherwise rests near fair.',
  bot_contrarian:
    'Tier 2 — fades the recent trade direction. Bets YES went too far up or too far down.',
  bot_momentum:
    'Tier 2 — chases the recent trade direction. Bets the move continues.',
  bot_random:
    'Tier 2 — small random orders near fair. The noise floor; should be the worst performer over time.',
};

export default function BotsPage(): JSX.Element {
  const q = useQuery({
    queryKey: ['bots-stats'],
    queryFn: () => api.botStats(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bots</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Five synthetic traders run by Crossbar to seed liquidity and stress-test the matching
          engine. Each bot trades exactly the same way you do — JWT-authenticated, order-book
          based, no shortcuts.
        </p>
      </div>

      {q.isLoading && <div className="h-64 animate-pulse rounded-lg bg-slate-900/40" />}
      {q.error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
          Failed to load bot stats.
        </div>
      )}

      {q.data && (
        <>
          {/* Bot table */}
          <Card className="p-0">
            <div className="border-b border-slate-800 px-4 py-3">
              <CardTitle className="text-sm">Live Performance</CardTitle>
              <CardSubtitle className="mt-1">
                Aggregated from each bot's positions and the markets they've traded.
              </CardSubtitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2 text-left">Bot</th>
                    <th className="px-4 py-2 text-right">Markets traded</th>
                    <th className="px-4 py-2 text-right">Resolved</th>
                    <th className="px-4 py-2 text-right">Accuracy</th>
                    <th className="px-4 py-2 text-right">Brier</th>
                    <th className="px-4 py-2 text-right">Realized P&L</th>
                    <th className="px-4 py-2 text-right">Cash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {q.data.bots.map((b) => (
                    <BotRow key={b.userId} bot={b} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Daily accuracy — platform vs each bot over time */}
          <DailyAccuracySection />

          {/* Simulated backtest summary */}
          {q.data.backtest && (
            <Card className="p-0">
              <div className="border-b border-slate-800 px-4 py-3">
                <CardTitle className="text-sm">
                  Simulated Backtest · {q.data.backtest.events} synthetic events
                </CardTitle>
                <CardSubtitle className="mt-1">
                  Auto-run by the API every 10 minutes. Monte Carlo Markov draw of game probabilities
                  + outcomes; gives an immediate signal on each strategy's edge before real games
                  resolve.
                </CardSubtitle>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-2 text-left">Bot</th>
                      <th className="px-4 py-2 text-right">Predictions</th>
                      <th className="px-4 py-2 text-right">Accuracy</th>
                      <th className="px-4 py-2 text-right">Brier</th>
                      <th className="px-4 py-2 text-right">Net P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900">
                    {q.data.bots.map((b) =>
                      b.simulated ? <SimRow key={b.userId} bot={b} sim={b.simulated} /> : null,
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Calibration plots — show live if any bot has ≥3 resolved, else simulated */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-brand" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                Calibration Plots
              </h2>
              {q.data.bots.every((b) => b.marketsResolved < 3) && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Simulated
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {q.data.bots.map((b) => {
                const useLive = b.marketsResolved >= 3;
                const bins = useLive ? b.calibration : b.simulated?.calibration ?? [];
                const n = useLive ? b.marketsResolved : b.simulated?.predictions ?? 0;
                const acc = useLive
                  ? b.accuracy
                  : b.simulated
                    ? b.simulated.accuracy
                    : null;
                const brier = useLive
                  ? b.brierScore
                  : b.simulated
                    ? b.simulated.brierScore
                    : null;
                if (bins.length === 0) return null;
                return (
                  <CalibrationCard
                    key={b.userId}
                    username={b.username}
                    bins={bins}
                    n={n}
                    accuracy={acc}
                    brier={brier}
                    source={useLive ? 'live' : 'simulated'}
                  />
                );
              })}
            </div>
          </div>

          {/* About */}
          <Card>
            <CardTitle className="text-sm">Accuracy Measurement</CardTitle>
            <CardSubtitle className="mt-2 leading-relaxed">
              For every resolved market each bot holds a position in, we read their net position
              direction and the price they paid. An entry at $0.65 on YES is treated as a "65%
              confidence YES" prediction. <strong>Brier score</strong> = mean squared error of
              predicted-vs-realized probability (0 = perfect, 0.25 = random coin flip).{' '}
              <strong>Calibration</strong> bins predictions by confidence and reports the actual
              win rate in each bucket — a well-calibrated bot's bins fall on the 45° diagonal.
            </CardSubtitle>
          </Card>
        </>
      )}
    </div>
  );
}

function BotRow({ bot }: { bot: BotStat }): JSX.Element {
  const acc = bot.accuracy != null ? `${(bot.accuracy * 100).toFixed(1)}%` : '—';
  const brier = bot.brierScore != null ? bot.brierScore.toFixed(4) : '—';
  return (
    <tr className="hover:bg-slate-900/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <BotIcon className="h-4 w-4 text-brand" />
          <div>
            <div className="font-semibold text-slate-100">@{bot.username}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{BOT_BLURBS[bot.username]}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="qty tabular">{bot.marketsTraded}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="qty tabular">{bot.marketsResolved}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <span
          className={cn(
            'tabular font-semibold',
            bot.accuracy == null
              ? 'text-slate-500'
              : bot.accuracy >= 0.55
                ? 'text-yes'
                : bot.accuracy <= 0.45
                  ? 'text-no'
                  : 'text-slate-200',
          )}
        >
          {acc}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="tabular text-slate-200">{brier}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <span
          className={cn(
            'money tabular font-semibold',
            bot.realizedPnl > 0 ? 'text-yes' : bot.realizedPnl < 0 ? 'text-no' : 'text-slate-300',
          )}
        >
          {bot.realizedPnl >= 0 ? '+' : ''}
          {formatDollars(bot.realizedPnl)}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="money tabular text-slate-300">{formatDollars(bot.balance)}</span>
      </td>
    </tr>
  );
}

function SimRow({ bot, sim }: { bot: BotStat; sim: BotSimulatedStat }): JSX.Element {
  return (
    <tr className="hover:bg-slate-900/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <BotIcon className="h-4 w-4 text-slate-500" />
          <span className="font-semibold text-slate-100">@{bot.username}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular">{sim.predictions}</td>
      <td className="px-4 py-3 text-right">
        <span
          className={cn(
            'tabular font-semibold',
            sim.accuracy >= 0.55 ? 'text-yes' : sim.accuracy <= 0.45 ? 'text-no' : 'text-slate-200',
          )}
        >
          {(sim.accuracy * 100).toFixed(1)}%
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular text-slate-200">{sim.brierScore.toFixed(4)}</td>
      <td className="px-4 py-3 text-right">
        <span
          className={cn(
            'money tabular font-semibold',
            sim.pnlCents > 0 ? 'text-yes' : sim.pnlCents < 0 ? 'text-no' : 'text-slate-300',
          )}
        >
          {sim.pnlCents >= 0 ? '+' : ''}
          {formatDollars(sim.pnlCents)}
        </span>
      </td>
    </tr>
  );
}

function CalibrationCard({
  username,
  bins,
  n,
  accuracy,
  brier,
  source,
}: {
  username: string;
  bins: BotCalibrationBin[];
  n: number;
  accuracy: number | null;
  brier: number | null;
  source: 'live' | 'simulated';
}): JSX.Element {
  const data = bins.map((c) => ({
    predicted: c.predicted,
    actual: c.actual,
    count: c.count,
  }));
  const diagonal = [
    { predicted: 0, actual: 0 },
    { predicted: 100, actual: 100 },
  ];
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="text-sm">@{username}</CardTitle>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            source === 'live' ? 'bg-yes-tint text-yes' : 'bg-slate-800 text-slate-400',
          )}
        >
          {source}
        </span>
      </div>
      <CardSubtitle className="mt-1">
        {n} {source === 'live' ? 'resolved markets' : 'predictions'} ·{' '}
        <span className="tabular">{accuracy != null ? (accuracy * 100).toFixed(0) : '–'}%</span>{' '}
        accuracy · Brier{' '}
        <span className="tabular">{brier != null ? brier.toFixed(3) : '–'}</span>
      </CardSubtitle>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 24, left: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
            <XAxis
              dataKey="predicted"
              type="number"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`}
              stroke="#475569"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              label={{
                value: 'Predicted',
                position: 'insideBottom',
                offset: -10,
                fill: '#64748b',
                fontSize: 10,
              }}
            />
            <YAxis
              dataKey="actual"
              type="number"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`}
              stroke="#475569"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: 100, y: 100 },
              ]}
              stroke="#334155"
              strokeDasharray="3 3"
            />
            <Tooltip
              contentStyle={{
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [
                `${value}%`,
                name === 'actual' ? 'Actual' : 'Predicted',
              ]}
            />
            <Scatter data={data} fill="#22d3ee" />
            <Line data={diagonal} dataKey="actual" stroke="#334155" dot={false} legendType="none" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

const RANGES: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function DailyAccuracySection(): JSX.Element {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ['bots-daily-accuracy', days],
    queryFn: () => api.botDailyAccuracy(days),
    refetchInterval: 5 * 60_000,
  });

  const series = ['platform', ...(q.data?.bots ?? [])];
  // recharts wants oldest→newest left to right; the API returns newest-first.
  const chartData = [...(q.data?.days ?? [])].reverse().map((d) => {
    const row: Record<string, number | string | null> = { date: d.date.slice(5) };
    row.platform = d.platformAccuracy != null ? Math.round(d.platformAccuracy * 100) : null;
    for (const [name, cell] of Object.entries(d.bots)) {
      row[name] = cell.accuracy != null ? Math.round(cell.accuracy * 100) : null;
    }
    return row;
  });

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <LineChartIcon className="h-4 w-4 text-brand" />
          <div>
            <CardTitle className="text-sm">Daily Accuracy</CardTitle>
            <CardSubtitle className="mt-1">
              Share of that day's resolved markets each bot called correctly (entry price &gt; 50¢ ⇒
              YES), vs. the platform's closing-price call.
            </CardSubtitle>
          </div>
        </div>
        <div className="flex rounded-md border border-slate-800 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setDays(r.days)}
              className={cn(
                'rounded px-3 py-1 text-xs font-semibold transition-colors',
                days === r.days ? 'bg-slate-700 text-slate-50' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <div className="m-4 h-64 animate-pulse rounded-lg bg-slate-900/40" />}
      {q.data && chartData.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          No markets have resolved in this window yet.
        </div>
      )}

      {q.data && chartData.length > 0 && (
        <>
          <div className="h-72 px-2 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                <XAxis dataKey="date" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v) => `${v}%`}
                  stroke="#475569"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <ReferenceLine y={50} stroke="#334155" strokeDasharray="3 3" />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number, name: string) => [`${value}%`, seriesLabel(name)]}
                />
                <Legend formatter={(value: string) => seriesLabel(value)} wrapperStyle={{ fontSize: 11 }} />
                {series.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={seriesColor(key)}
                    strokeWidth={key === 'platform' ? 2.5 : 1.5}
                    dot={false}
                    connectNulls
                    strokeDasharray={key === 'platform' ? undefined : undefined}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto border-t border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Platform</th>
                  {(q.data.bots ?? []).map((b) => (
                    <th key={b} className="px-4 py-2 text-right">
                      {b.replace('bot_', '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {q.data.days.map((d) => (
                  <DailyRow key={d.date} row={d} bots={q.data!.bots} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function AccuracyCell({
  accuracy,
  resolved,
}: {
  accuracy: number | null;
  resolved: number;
}): JSX.Element {
  if (accuracy == null) return <span className="text-slate-600">—</span>;
  return (
    <span
      className={cn(
        'tabular font-semibold',
        accuracy >= 0.55 ? 'text-yes' : accuracy <= 0.45 ? 'text-no' : 'text-slate-200',
      )}
      title={`${resolved} resolved`}
    >
      {(accuracy * 100).toFixed(0)}%
    </span>
  );
}

function DailyRow({ row, bots }: { row: DailyAccuracyRow; bots: string[] }): JSX.Element {
  return (
    <tr className="hover:bg-slate-900/50">
      <td className="px-4 py-2.5 font-medium text-slate-200">{row.date}</td>
      <td className="px-4 py-2.5 text-right">
        <AccuracyCell accuracy={row.platformAccuracy} resolved={row.platformResolved} />
        <span className="ml-1 text-[10px] text-slate-600">({row.platformResolved})</span>
      </td>
      {bots.map((b) => (
        <td key={b} className="px-4 py-2.5 text-right">
          <AccuracyCell accuracy={row.bots[b]?.accuracy ?? null} resolved={row.bots[b]?.resolved ?? 0} />
        </td>
      ))}
    </tr>
  );
}
