'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDollars } from '@/lib/format';

export default function AdminUsersPage(): JSX.Element {
  const [topupUserId, setTopupUserId] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.adminUsers({ limit: 200 }),
    refetchInterval: 30_000,
  });

  const topup = useMutation({
    mutationFn: () => {
      if (!topupUserId) throw new Error('no user');
      return api.adminTopupUser(topupUserId, Number(topupAmount));
    },
    onSuccess: () => {
      setTopupUserId(null);
      setTopupAmount('');
      setError(null);
      void usersQ.refetch();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Unknown error'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Users</h1>

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2 text-right">Reserved</th>
              <th className="px-3 py-2 text-right">Topup</th>
            </tr>
          </thead>
          <tbody>
            {usersQ.data?.map((u) => (
              <tr key={u.id} className="border-b border-slate-900">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-100">@{u.username}</span>
                    {u.isAdmin && <Badge tone="brand">admin</Badge>}
                  </div>
                  <div className="text-[10px] text-slate-500">{u.id}</div>
                </td>
                <td className="px-3 py-2 text-slate-300">{u.email}</td>
                <td className="tabular px-3 py-2 text-right text-slate-100">
                  {u.wallet ? formatDollars(u.wallet.balance) : '—'}
                </td>
                <td className="tabular px-3 py-2 text-right text-slate-400">
                  {u.wallet ? formatDollars(u.wallet.reserved) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {topupUserId === u.id ? (
                    <span className="inline-flex items-center gap-2">
                      <input
                        type="number"
                        value={topupAmount}
                        onChange={(e) => setTopupAmount(e.target.value)}
                        placeholder="cents"
                        className="w-24 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                      />
                      <Button
                        size="sm"
                        onClick={() => topup.mutate()}
                        disabled={!topupAmount || topup.isPending}
                      >
                        {topup.isPending ? '…' : 'Confirm'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTopupUserId(null);
                          setTopupAmount('');
                        }}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setTopupUserId(u.id)}>
                      Topup
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
