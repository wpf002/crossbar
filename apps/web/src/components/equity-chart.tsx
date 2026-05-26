'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { formatDollars } from '@/lib/format';
import { cn } from '@/lib/cn';

type Range = '1D' | '1W' | '1M';
const RANGE_HOURS: Record<Range, number> = { '1D': 24, '1W': 168, '1M': 720 };

export function EquityChart(): JSX.Element {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>('1W');
  const hours = RANGE_HOURS[range];

  const { data, isLoading } = useQuery({
    queryKey: ['equity', token, hours],
    queryFn: () => api.equity({ hours }),
    enabled: !!token,
  });

  // Debounced refetch when /me trade events arrive — listen via the query
  // cache. We watch `['my-trades', token]` and trigger a refetch 5s after
  // the last change.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = qc.getQueryCache().subscribe((evt) => {
      if (
        evt.type === 'updated' &&
        Array.isArray(evt.query.queryKey) &&
        evt.query.queryKey[0] === 'my-trades'
      ) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void qc.invalidateQueries({ queryKey: ['equity', token, hours] });
        }, 5_000);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [qc, token, hours]);

  const points = useMemo(() => {
    return (data?.points ?? []).map((p) => ({
      t: new Date(p.ts).getTime(),
      equity: p.equity,
    }));
  }, [data]);

  const { delta, deltaPct } = useMemo(() => {
    if (points.length < 2) return { delta: 0, deltaPct: 0 };
    const first = points[0]!.equity;
    const last = points[points.length - 1]!.equity;
    return {
      delta: last - first,
      deltaPct: first === 0 ? 0 : ((last - first) / first) * 100,
    };
  }, [points]);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Equity over {range}
          </div>
          <div className="money tabular mt-1 text-2xl font-bold text-slate-50">
            {points.length > 0
              ? formatDollars(points[points.length - 1]!.equity)
              : '—'}
          </div>
          <div
            className={cn(
              'mt-0.5 text-xs font-semibold tabular',
              delta > 0 && 'text-yes',
              delta < 0 && 'text-no',
              delta === 0 && 'text-slate-500',
            )}
          >
            {delta >= 0 ? '+' : ''}
            {formatDollars(delta)} ({deltaPct >= 0 ? '+' : ''}
            {deltaPct.toFixed(2)}%)
          </div>
        </div>
        <div className="flex gap-1">
          {(['1D', '1W', '1M'] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                range === r
                  ? 'bg-slate-800 text-slate-50'
                  : 'text-slate-500 hover:text-slate-200',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 h-44 w-full">
        {isLoading ? (
          <div className="h-full w-full animate-pulse rounded-md bg-slate-900/40" />
        ) : points.length < 2 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            Not enough trading activity yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(34, 211, 238)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="rgb(34, 211, 238)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t) => formatTimeForRange(t, range)}
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                dataKey="equity"
                domain={['auto', 'auto']}
                tickFormatter={(v) => formatDollars(v)}
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid #1e293b',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={(t: number) => new Date(t).toLocaleString()}
                formatter={(v: number) => [formatDollars(v), 'Equity']}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="rgb(34, 211, 238)"
                strokeWidth={2}
                fill="url(#equityFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function formatTimeForRange(t: number, range: Range): string {
  const d = new Date(t);
  if (range === '1D') {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
