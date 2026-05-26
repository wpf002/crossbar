'use client';

import { useQuery } from '@tanstack/react-query';
import { Trophy, Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import { formatDollars } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function LeaderboardPage(): JSX.Element {
  const q = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => api.leaderboard(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Top traders by realized P&L and 24-hour volume.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
            <Trophy className="h-4 w-4 text-yes" />
            <CardTitle className="text-sm">Top by realized P&L</CardTitle>
          </div>
          {q.isLoading ? (
            <CardSubtitle className="p-4">Loading…</CardSubtitle>
          ) : q.data?.byPnl.length === 0 ? (
            <CardSubtitle className="p-4">No resolved positions yet.</CardSubtitle>
          ) : (
            <ol className="divide-y divide-slate-900">
              {q.data?.byPnl.map((row, i) => (
                <li key={row.userId} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-2">
                  <span className="tabular text-xs font-bold text-slate-500">{i + 1}</span>
                  <span className="text-sm font-semibold text-slate-100">@{row.username}</span>
                  <span
                    className={cn(
                      'money tabular text-sm font-bold',
                      row.realizedPnl > 0 ? 'text-yes' : row.realizedPnl < 0 ? 'text-no' : 'text-slate-300',
                    )}
                  >
                    {row.realizedPnl >= 0 ? '+' : ''}
                    {formatDollars(row.realizedPnl)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="p-0">
          <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
            <Activity className="h-4 w-4 text-brand" />
            <CardTitle className="text-sm">Top by 24h volume</CardTitle>
          </div>
          {q.isLoading ? (
            <CardSubtitle className="p-4">Loading…</CardSubtitle>
          ) : q.data?.byVolume.length === 0 ? (
            <CardSubtitle className="p-4">No trades in the last 24h.</CardSubtitle>
          ) : (
            <ol className="divide-y divide-slate-900">
              {q.data?.byVolume.map((row, i) => (
                <li key={row.userId} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-2">
                  <span className="tabular text-xs font-bold text-slate-500">{i + 1}</span>
                  <span className="text-sm font-semibold text-slate-100">@{row.username}</span>
                  <span className="money tabular text-sm font-bold text-slate-200">
                    {formatDollars(row.volume24h)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
