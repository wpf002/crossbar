'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMarketStream, useMeStream } from '@/lib/sse';
import type { Position } from '@/lib/types';
import { OrderBookView } from '@/components/order-book';
import { PriceChart } from '@/components/price-chart';
import { MarketBuyPair } from '@/components/market-buy-pair';
import { CommentsPanel } from '@/components/comments-panel';
import { Badge } from '@/components/ui/badge';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import { TeamMark } from '@/components/team-mark';
import { useSlip } from '@/lib/slip';
import { formatDollars, formatGameTime, formatPrice, marketTypeLabel } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function MarketDetailPage({ params }: { params: { id: string } }): JSX.Element {
  const { id } = params;
  const { token } = useAuth();
  const { setLeg } = useSlip();
  const [chartHours, setChartHours] = useState<number>(24);

  useMarketStream(id);
  useMeStream();

  const marketQ = useQuery({
    queryKey: ['market', id],
    queryFn: () => api.market(id),
    // SSE keeps book/trades hot; a 30s safety refetch covers any drift.
    refetchInterval: 30_000,
  });
  const bookQ = useQuery({
    queryKey: ['book', id],
    queryFn: () => api.marketBook(id),
    refetchInterval: 30_000,
  });
  const tradesQ = useQuery({
    queryKey: ['trades', id],
    queryFn: () => api.marketTrades(id, { limit: 20 }),
    refetchInterval: 30_000,
  });
  const candlesQ = useQuery({
    queryKey: ['candles', id, chartHours],
    queryFn: () => api.marketCandles(id, { hours: chartHours, bucket: bucketForHours(chartHours) }),
    refetchInterval: 30_000,
  });
  const positionQ = useQuery<Position | null>({
    queryKey: ['position', id, token],
    queryFn: async () => {
      const all = await api.positions();
      return all.find((p) => p.marketId === id) ?? null;
    },
    enabled: !!token,
    refetchInterval: 30_000,
  });
  // Sibling markets on the same event — lets users jump between game lines and
  // the player props for this matchup.
  const relatedQ = useQuery({
    queryKey: ['markets', 'event', marketQ.data?.event.id],
    queryFn: () => api.listMarkets({ eventId: marketQ.data!.event.id }),
    enabled: !!marketQ.data?.event.id,
    refetchInterval: 60_000,
  });

  const market = marketQ.data;
  if (marketQ.isLoading) return <div className="h-64 animate-pulse rounded-lg bg-slate-900/40" />;
  if (marketQ.error || !market) {
    return (
      <div className="rounded-md border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
        Market not found.
      </div>
    );
  }

  const ev = market.event;
  const isLive = ev.status === 'LIVE';
  const siblings = (relatedQ.data ?? []).filter((m) => m.id !== market.id);
  const propSiblings = siblings.filter((m) => m.type === 'PLAYER_TOTAL');
  const periodSiblings = siblings
    .filter((m) => m.type === 'PERIOD_WINNER')
    .sort((a, b) => (a.period ?? 0) - (b.period ?? 0));
  const gameSiblings = siblings.filter(
    (m) => m.type !== 'PLAYER_TOTAL' && m.type !== 'PERIOD_WINNER',
  );

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All markets
      </Link>

      {/* Header */}
      <header className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{ev.sportId.toUpperCase()}</Badge>
              <Badge tone="neutral">{marketTypeLabel(market.type)}</Badge>
              {isLive && <Badge tone="live">LIVE</Badge>}
              {ev.status === 'FINAL' && <Badge tone="neutral">FINAL</Badge>}
            </div>
            <h1 className="mt-3 text-xl font-bold text-slate-50 sm:text-2xl">{market.question}</h1>
            {market.player && (
              <div className="mt-1 text-sm font-medium text-slate-400">
                {market.player.name}
                {market.player.position ? ` · ${market.player.position}` : ''} · {market.player.team}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-300">
              <span className="inline-flex items-center gap-2">
                <TeamMark team={ev.awayTeam} size="sm" />
                {ev.awayTeam}
              </span>
              <span className="text-slate-600">@</span>
              <span className="inline-flex items-center gap-2">
                <TeamMark team={ev.homeTeam} size="sm" />
                {ev.homeTeam}
              </span>
              <span className="text-xs text-slate-500">{formatGameTime(ev.startsAt)}</span>
            </div>
            {(isLive || ev.status === 'FINAL') && ev.homeScore != null && ev.awayScore != null && (
              <div className="mt-2 text-sm font-bold text-slate-200">
                {lastWord(ev.awayTeam)} {ev.awayScore} — {ev.homeScore} {lastWord(ev.homeTeam)}
                {isLive && ev.displayClock && (
                  <span className="ml-2 text-xs font-semibold text-live">{ev.displayClock}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content: two columns on desktop */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* Buy pair */}
          {market.status === 'OPEN' ? (
            <MarketBuyPair market={market} snapshot={bookQ.data} />
          ) : (
            <Card>
              <CardTitle>Market {market.status.toLowerCase()}</CardTitle>
              <CardSubtitle className="mt-1">
                {market.status === 'RESOLVED'
                  ? `Resolved ${market.outcome}.`
                  : market.status === 'VOIDED'
                    ? 'This market was voided; all positions refunded at cost basis.'
                    : 'No new orders accepted.'}
              </CardSubtitle>
            </Card>
          )}

          {/* Chart */}
          <Card>
            <PriceChart
              candles={candlesQ.data?.candles}
              loading={candlesQ.isLoading}
              onRangeChange={setChartHours}
            />
          </Card>

          {/* Order book */}
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Order book
            </h2>
            <OrderBookView
              snapshot={bookQ.data}
              onPickPrice={(outcome, price, side) =>
                setLeg({
                  marketId: id,
                  marketLabel: `${ev.awayTeam} @ ${ev.homeTeam} · ${market.type}`,
                  outcome,
                  side,
                  price,
                  quantity: 10,
                })
              }
            />
          </div>

          {/* Recent trades */}
          <Card className="p-0">
            <div className="border-b border-slate-800 px-4 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Recent trades
              </h2>
            </div>
            {tradesQ.data?.trades.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-500">No trades yet.</p>
            ) : (
              <div className="divide-y divide-slate-900">
                <div className="grid grid-cols-4 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <span>Time</span>
                  <span>Side</span>
                  <span>Price</span>
                  <span className="text-right">Qty</span>
                </div>
                {tradesQ.data?.trades.map((t) => {
                  const time = new Date(t.createdAt).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                  });
                  return (
                    <div
                      key={t.id}
                      className="grid grid-cols-4 items-center px-4 py-1.5 text-xs"
                    >
                      <span className="tabular text-slate-500">{time}</span>
                      <span
                        className={cn(
                          'font-bold',
                          t.outcome === 'YES' ? 'text-yes' : 'text-no',
                        )}
                      >
                        {t.outcome}
                      </span>
                      <span className="price tabular text-slate-200">${(t.price / 100).toFixed(2)}</span>
                      <span className="qty tabular text-right text-slate-400">{t.quantity}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Comments */}
          <Card>
            <CommentsPanel marketId={id} />
          </Card>
        </div>

        {/* Right rail: your position (sticky on desktop) */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {positionQ.data ? (
            <Card>
              <CardTitle className="text-sm">Your position</CardTitle>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <Stat label="YES" value={positionQ.data.yesShares.toString()} />
                <Stat label="NO" value={positionQ.data.noShares.toString()} />
                <Stat label="Avg YES cost" value={formatPrice(positionQ.data.avgYesCost)} />
                <Stat label="Avg NO cost" value={formatPrice(positionQ.data.avgNoCost)} />
                <Stat
                  label="Realized P&L"
                  value={formatDollars(positionQ.data.realizedPnl)}
                  tone={
                    positionQ.data.realizedPnl > 0
                      ? 'yes'
                      : positionQ.data.realizedPnl < 0
                        ? 'no'
                        : 'neutral'
                  }
                />
              </div>
            </Card>
          ) : token ? (
            <Card>
              <CardTitle className="text-sm">No position yet</CardTitle>
              <CardSubtitle className="mt-2">
                Place an order to build a position in this market.
              </CardSubtitle>
            </Card>
          ) : null}

          {gameSiblings.length > 0 && (
            <Card>
              <CardTitle className="text-sm">More markets for this game</CardTitle>
              <div className="mt-3 space-y-1.5">
                {gameSiblings.map((m) => (
                  <SiblingLink key={m.id} id={m.id} label={marketTypeLabel(m.type)} text={m.question} />
                ))}
              </div>
            </Card>
          )}

          {periodSiblings.length > 0 && (
            <Card>
              <CardTitle className="text-sm">By period</CardTitle>
              <div className="mt-3 space-y-1.5">
                {periodSiblings.map((m) => (
                  <SiblingLink key={m.id} id={m.id} label={marketTypeLabel(m.type)} text={m.question} />
                ))}
              </div>
            </Card>
          )}

          {propSiblings.length > 0 && (
            <Card>
              <CardTitle className="text-sm">Player props</CardTitle>
              <div className="mt-3 space-y-1.5">
                {propSiblings.map((m) => (
                  <SiblingLink
                    key={m.id}
                    id={m.id}
                    label={m.player?.name ?? 'Prop'}
                    text={m.question}
                  />
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'yes' | 'no' | 'neutral';
}): JSX.Element {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={cn(
          'tabular text-sm font-semibold',
          tone === 'yes' && 'text-yes',
          tone === 'no' && 'text-no',
          tone === 'neutral' && 'text-slate-100',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function lastWord(s: string): string {
  return s.split(' ').slice(-1)[0] ?? s;
}

function SiblingLink({ id, label, text }: { id: string; label: string; text: string }): JSX.Element {
  return (
    <Link
      href={`/markets/${id}`}
      className="block rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 transition-colors hover:border-slate-700"
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="truncate text-xs text-slate-300">{text}</div>
    </Link>
  );
}

function bucketForHours(hours: number): number {
  if (hours <= 1) return 60_000; // 1m
  if (hours <= 6) return 5 * 60_000; // 5m
  if (hours <= 24) return 15 * 60_000; // 15m
  return 60 * 60_000; // 1h
}
