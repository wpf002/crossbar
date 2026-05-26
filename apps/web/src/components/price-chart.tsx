'use client';

import { useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import type { Candle } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Loader2 } from 'lucide-react';

interface Props {
  candles: Candle[] | undefined;
  loading?: boolean;
  height?: number;
  onRangeChange?: (hours: number) => void;
}

const RANGES = [
  { label: '1H', hours: 1 },
  { label: '6H', hours: 6 },
  { label: '1D', hours: 24 },
  { label: '1W', hours: 168 },
];

export function PriceChart({ candles, loading, height = 220, onRangeChange }: Props): JSX.Element {
  const [active, setActive] = useState<number>(24);

  const data = (candles ?? []).map((c) => ({
    t: c.t,
    price: c.c,
    label: new Date(c.t).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }),
  }));

  const last = data[data.length - 1]?.price ?? null;
  const first = data[0]?.price ?? null;
  const delta = last != null && first != null ? last - first : null;
  const up = (delta ?? 0) >= 0;
  const stroke = up ? '#4ade80' : '#f87171';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          {last != null ? (
            <div className="flex items-baseline gap-2">
              <span className="price text-3xl font-bold text-slate-50">${(last / 100).toFixed(2)}</span>
              {delta != null && (
                <span className={cn('text-sm font-semibold', up ? 'text-yes' : 'text-no')}>
                  {up ? '+' : ''}${(delta / 100).toFixed(2)} ({first != null && first > 0 ? `${((delta / first) * 100).toFixed(1)}%` : '0%'})
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-slate-500">No trades yet</span>
          )}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              onClick={() => {
                setActive(r.hours);
                onRangeChange?.(r.hours);
              }}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                active === r.hours
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative" style={{ height }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!loading && data.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-800 text-xs text-slate-600">
            No price history yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `$${(v / 100).toFixed(2)}`}
                width={36}
              />
              <ReferenceLine y={50} stroke="#1e293b" strokeDasharray="2 4" />
              <Tooltip
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid #1e293b',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(v: number) => [`$${(v / 100).toFixed(2)}`, 'YES']}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke={stroke}
                strokeWidth={2}
                fill="url(#priceFill)"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
