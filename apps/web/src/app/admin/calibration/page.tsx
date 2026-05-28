'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { Target } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import type { CalibrationBucket } from '@/lib/types';

const RANGES: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All time', days: 36500 },
];

export default function CalibrationPage(): JSX.Element {
  const [days, setDays] = useState(30);

  const q = useQuery({
    queryKey: ['admin', 'calibration', days],
    queryFn: () => api.adminCalibration(days),
    refetchInterval: 5 * 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calibration</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Are our closing prices honest? For every resolved market we take the last trade price
            as the implied YES probability and check it against what actually happened. A
            well-calibrated platform's points sit on the 45° line — when we close at 70¢, YES wins
            70% of the time.
          </p>
        </div>
        <div className="flex rounded-md border border-slate-800 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                days === r.days
                  ? 'bg-slate-700 text-slate-50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <div className="h-64 animate-pulse rounded-lg bg-slate-900/40" />}
      {q.error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
          Failed to load calibration data.
        </div>
      )}

      {q.data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Brier Score"
              value={q.data.brierScore != null ? q.data.brierScore.toFixed(4) : '—'}
              hint="Lower is better · 0.25 = coin flip"
            />
            <Stat
              label="Calibration Error"
              value={q.data.calibrationError != null ? q.data.calibrationError.toFixed(4) : '—'}
              hint="Weighted |actual − implied|"
            />
            <Stat label="Resolved Markets" value={String(q.data.totalMarkets)} hint="In window" />
          </div>

          {q.data.totalMarkets === 0 ? (
            <Card>
              <CardSubtitle>No resolved markets in this window yet.</CardSubtitle>
            </Card>
          ) : (
            <>
              <Card>
                <div className="mb-3 flex items-center gap-2">
                  <Target className="h-4 w-4 text-brand" />
                  <CardTitle className="text-sm">Reliability Diagram</CardTitle>
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 16, bottom: 28, left: 8 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
                      <XAxis
                        dataKey="expectedYesProb"
                        type="number"
                        domain={[0, 1]}
                        ticks={[0, 0.25, 0.5, 0.75, 1]}
                        tickFormatter={(v) => `${Math.round(v * 100)}%`}
                        stroke="#475569"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        label={{
                          value: 'Implied probability (closing price)',
                          position: 'insideBottom',
                          offset: -14,
                          fill: '#64748b',
                          fontSize: 10,
                        }}
                      />
                      <YAxis
                        dataKey="actualYesProb"
                        type="number"
                        domain={[0, 1]}
                        ticks={[0, 0.25, 0.5, 0.75, 1]}
                        tickFormatter={(v) => `${Math.round(v * 100)}%`}
                        stroke="#475569"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                        label={{
                          value: 'Actual YES rate',
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#64748b',
                          fontSize: 10,
                        }}
                      />
                      <ZAxis dataKey="sampleSize" type="number" range={[40, 400]} name="Sample" />
                      <ReferenceLine
                        segment={[
                          { x: 0, y: 0 },
                          { x: 1, y: 1 },
                        ]}
                        stroke="#334155"
                        strokeDasharray="3 3"
                      />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<BucketTooltip />} />
                      <Scatter data={q.data.buckets} fill="#22d3ee" fillOpacity={0.7} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-0">
                <div className="border-b border-slate-800 px-4 py-3">
                  <CardTitle className="text-sm">Bucket Breakdown</CardTitle>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="px-4 py-2 text-left">Bucket (¢)</th>
                        <th className="px-4 py-2 text-right">Samples</th>
                        <th className="px-4 py-2 text-right">Implied YES</th>
                        <th className="px-4 py-2 text-right">Actual YES</th>
                        <th className="px-4 py-2 text-right">Δ</th>
                        <th className="px-4 py-2 text-right">Brier contrib.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {q.data.buckets.map((b) => (
                        <BucketRow key={b.bin} bucket={b} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}): JSX.Element {
  return (
    <Card className="p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="tabular mt-1 text-xl font-bold text-slate-50">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>
    </Card>
  );
}

function BucketRow({ bucket }: { bucket: CalibrationBucket }): JSX.Element {
  const delta = bucket.actualYesProb - bucket.expectedYesProb;
  return (
    <tr className="hover:bg-slate-900/50">
      <td className="px-4 py-2.5 font-semibold text-slate-100">{bucket.bin}</td>
      <td className="px-4 py-2.5 text-right tabular">{bucket.sampleSize}</td>
      <td className="px-4 py-2.5 text-right tabular text-slate-300">
        {(bucket.expectedYesProb * 100).toFixed(0)}%
      </td>
      <td className="px-4 py-2.5 text-right tabular text-slate-300">
        {(bucket.actualYesProb * 100).toFixed(0)}%
      </td>
      <td
        className={`px-4 py-2.5 text-right tabular font-semibold ${
          Math.abs(delta) < 0.05 ? 'text-slate-400' : delta > 0 ? 'text-yes' : 'text-no'
        }`}
      >
        {delta >= 0 ? '+' : ''}
        {(delta * 100).toFixed(0)}%
      </td>
      <td className="px-4 py-2.5 text-right tabular text-slate-400">
        {bucket.brierContrib.toFixed(4)}
      </td>
    </tr>
  );
}

function BucketTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CalibrationBucket }>;
}): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const b = payload[0]!.payload;
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-2.5 text-xs">
      <div className="font-semibold text-slate-100">{b.bin}¢ bucket</div>
      <div className="mt-1 space-y-0.5 text-slate-400">
        <div>
          Samples: <span className="tabular text-slate-200">{b.sampleSize}</span>
        </div>
        <div>
          Implied YES:{' '}
          <span className="tabular text-slate-200">{(b.expectedYesProb * 100).toFixed(0)}%</span>
        </div>
        <div>
          Actual YES:{' '}
          <span className="tabular text-slate-200">{(b.actualYesProb * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}
