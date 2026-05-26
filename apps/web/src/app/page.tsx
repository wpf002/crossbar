'use client';

import { useState, useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMarketsListStream } from '@/lib/sse';
import type { MarketListItem, SportId } from '@/lib/types';
import { SportTabs } from '@/components/sport-tabs';
import { GameRow } from '@/components/game-row';
import { formatDollars } from '@/lib/format';

export default function HomePage(): JSX.Element {
  const [sport, setSport] = useState<'ALL' | SportId>('ALL');

  useMarketsListStream();

  const { data, isLoading, error } = useQuery({
    queryKey: ['markets', sport],
    queryFn: () => api.listMarkets(sport === 'ALL' ? {} : { sport }),
    refetchInterval: 30_000,
  });

  const grouped = useMemo(() => groupByEvent(filterUpcoming(data ?? [])), [data]);

  // For each event, fetch a short sparkline of the moneyline's YES price.
  // Keep this opt-in / lightweight — 1h hours, 5-min buckets = ~12 points.
  const moneylineIds = grouped
    .map((g) => g[1].find((m) => m.type === 'MONEYLINE')?.id)
    .filter((v): v is string => !!v);

  const sparkQueries = useQueries({
    queries: moneylineIds.map((id) => ({
      queryKey: ['candles', id, 'spark'],
      queryFn: () => api.marketCandles(id, { hours: 6, bucket: 600_000 }),
      staleTime: 60_000,
      refetchInterval: 60_000,
    })),
  });
  const sparkByMarket = new Map<string, number[]>();
  moneylineIds.forEach((id, i) => {
    const candles = sparkQueries[i]?.data?.candles ?? [];
    sparkByMarket.set(id, candles.map((c) => c.c));
  });

  const stats = useMemo(() => {
    const all = data ?? [];
    const totalVol = all.reduce((a, m) => a + (m.volume24h ?? 0), 0);
    return { markets: all.length, events: grouped.length, vol: totalVol };
  }, [data, grouped]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today's Markets</h1>
          <p className="mt-1 text-sm text-slate-400">Peer-to-Peer Prediction Market</p>
        </div>
        <div className="flex items-stretch divide-x divide-slate-800 text-right">
          <Stat label="Events" value={stats.events.toString()} />
          <Stat label="Markets" value={stats.markets.toString()} />
          <Stat label="24h Volume" value={formatVolBig(stats.vol)} />
        </div>
      </div>

      <SportTabs value={sport} onChange={setSport} />

      {isLoading && <SkeletonList />}
      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
          Failed to load markets — is the API running?
        </div>
      )}
      {data && grouped.length === 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          No open markets yet. The resolver will populate them on its next tick.
        </div>
      )}

      <div className="space-y-2">
        {grouped.map(([eventId, markets]) => {
          const moneyline = markets.find((m) => m.type === 'MONEYLINE');
          const spark = moneyline ? sparkByMarket.get(moneyline.id) : undefined;
          return <GameRow key={eventId} markets={markets} spark={spark} />;
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="px-4 text-right first:pl-0 last:pr-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="tabular text-lg font-bold text-slate-100">{value}</div>
    </div>
  );
}

function formatVolBig(cents: number): string {
  if (cents === 0) return '$0';
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  return formatDollars(cents);
}

/**
 * Drop events that have already finished, been voided, or started too long ago
 * to plausibly still be running. Keeps SCHEDULED games in the future, and LIVE
 * games regardless of start time.
 */
function filterUpcoming(markets: MarketListItem[]): MarketListItem[] {
  const now = Date.now();
  // 8 hours covers the longest plausible live game (extra-innings, OT, etc.)
  const cutoff = now - 8 * 3600_000;
  return markets.filter((m) => {
    const ev = m.event;
    if (ev.status === 'FINAL' || ev.status === 'POSTPONED' || ev.status === 'CANCELED') {
      return false;
    }
    if (ev.status === 'LIVE') return true;
    return new Date(ev.startsAt).getTime() >= cutoff;
  });
}

function groupByEvent(markets: MarketListItem[]): Array<[string, MarketListItem[]]> {
  const map = new Map<string, MarketListItem[]>();
  for (const m of markets) {
    const arr = map.get(m.event.id) ?? [];
    arr.push(m);
    map.set(m.event.id, arr);
  }
  // Sort: LIVE first, then by start time.
  return [...map.entries()].sort(([, a], [, b]) => {
    const ea = a[0]!.event;
    const eb = b[0]!.event;
    if (ea.status === 'LIVE' && eb.status !== 'LIVE') return -1;
    if (eb.status === 'LIVE' && ea.status !== 'LIVE') return 1;
    return new Date(ea.startsAt).getTime() - new Date(eb.startsAt).getTime();
  });
}

function SkeletonList(): JSX.Element {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-lg border border-slate-800 bg-slate-900/40"
        />
      ))}
    </div>
  );
}
