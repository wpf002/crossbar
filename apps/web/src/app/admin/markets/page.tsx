'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardSubtitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const STATUSES = ['ALL', 'OPEN', 'CLOSED', 'RESOLVED', 'VOIDED'] as const;
type Status = (typeof STATUSES)[number];

export default function AdminMarketsPage(): JSX.Element {
  const [status, setStatus] = useState<Status>('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'markets', status],
    queryFn: () => api.adminMarkets(status === 'ALL' ? {} : { status }),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Markets</h1>
        <Link href="/admin/markets/new">
          <Button size="sm">Create market</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              status === s
                ? 'bg-slate-800 text-slate-50'
                : 'bg-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <CardSubtitle>Loading markets…</CardSubtitle>}

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2">Market</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((m) => (
              <tr key={m.id} className="border-b border-slate-900">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-100">{m.question}</div>
                  <div className="text-[10px] text-slate-500">{m.id}</div>
                </td>
                <td className="px-3 py-2 text-slate-300">{m.type}</td>
                <td className="px-3 py-2">
                  <Badge tone={badgeTone(m.status)}>{m.status}</Badge>
                </td>
                <td className="px-3 py-2 text-slate-300">
                  {m.event.awayTeam} @ {m.event.homeTeam}
                  <div className="text-[10px] text-slate-500">
                    {new Date(m.event.startsAt).toLocaleString()}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/admin/markets/${m.id}`}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  No markets match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function badgeTone(status: string): 'brand' | 'success' | 'danger' | 'neutral' | 'warning' {
  switch (status) {
    case 'OPEN':
      return 'brand';
    case 'RESOLVED':
      return 'success';
    case 'VOIDED':
      return 'danger';
    case 'CLOSED':
      return 'warning';
    default:
      return 'neutral';
  }
}
