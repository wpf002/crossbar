'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const STATUSES = ['ALL', 'SCHEDULED', 'LIVE', 'FINAL', 'POSTPONED', 'CANCELED'] as const;
type Status = (typeof STATUSES)[number];

export default function AdminEventsPage(): JSX.Element {
  const [status, setStatus] = useState<Status>('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'events', status],
    queryFn: () => api.adminEvents(status === 'ALL' ? {} : { status }),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Events</h1>

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

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Sport</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Markets</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((e) => (
              <tr key={e.id} className="border-b border-slate-900">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-100">
                    {e.awayTeam} @ {e.homeTeam}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {new Date(e.startsAt).toLocaleString()}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-300">{e.sportId.toUpperCase()}</td>
                <td className="px-3 py-2">
                  <Badge tone={e.status === 'LIVE' ? 'live' : 'neutral'}>{e.status}</Badge>
                </td>
                <td className="tabular px-3 py-2 text-slate-300">
                  {e.homeScore ?? '—'} – {e.awayScore ?? '—'}
                </td>
                <td className="px-3 py-2 text-slate-300">{e.marketCount}</td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/admin/events/${e.id}`}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    Finalize →
                  </Link>
                </td>
              </tr>
            ))}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                  No events match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
