'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Action = 'close' | 'resolve-yes' | 'resolve-no' | 'resolve-invalid' | 'void';

export default function AdminMarketDetailPage({
  params,
}: {
  params: { id: string };
}): JSX.Element {
  const router = useRouter();
  const { id } = params;
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The detail page reuses the public market endpoint for simplicity.
  const marketQ = useQuery({
    queryKey: ['market', id],
    queryFn: () => api.market(id),
  });

  const mutate = useMutation({
    mutationFn: async (action: Action) => {
      switch (action) {
        case 'close':
          return api.adminCloseMarket(id);
        case 'resolve-yes':
          return api.adminResolveMarket(id, 'YES');
        case 'resolve-no':
          return api.adminResolveMarket(id, 'NO');
        case 'resolve-invalid':
          return api.adminResolveMarket(id, 'INVALID');
        case 'void':
          return api.adminVoidMarket(id, voidReason);
      }
    },
    onSuccess: () => {
      setPendingAction(null);
      setError(null);
      void marketQ.refetch();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Unknown error'),
  });

  const m = marketQ.data;
  if (marketQ.isLoading) return <div className="h-32 animate-pulse rounded-lg bg-slate-900/40" />;
  if (!m) return <div className="text-sm text-slate-400">Market not found.</div>;

  const canClose = m.status === 'OPEN';
  const canResolve = m.status === 'OPEN' || m.status === 'CLOSED';

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => router.push('/admin/markets')}
        className="text-xs text-slate-500 hover:text-slate-200"
      >
        ← All markets
      </button>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{m.type}</Badge>
          <Badge tone="neutral">{m.status}</Badge>
          {m.outcome && <Badge tone="success">{m.outcome}</Badge>}
        </div>
        <CardTitle className="mt-3 text-base">{m.question}</CardTitle>
        <CardSubtitle className="mt-1">
          {m.event.awayTeam} @ {m.event.homeTeam} ·{' '}
          {new Date(m.event.startsAt).toLocaleString()}
        </CardSubtitle>
        <div className="mt-2 text-[10px] text-slate-500">{m.id}</div>
      </Card>

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <Card className="space-y-4">
        <CardTitle className="text-sm">Lifecycle actions</CardTitle>
        <CardSubtitle>
          Two-click confirm: pick an action then press Confirm.
        </CardSubtitle>

        <div className="flex flex-wrap gap-2">
          <ActionBtn
            label="Close"
            pending={pendingAction === 'close'}
            disabled={!canClose}
            onPick={() => setPendingAction('close')}
            onConfirm={() => mutate.mutate('close')}
            mutating={mutate.isPending}
          />
          <ActionBtn
            label="Resolve YES"
            variant="yes"
            pending={pendingAction === 'resolve-yes'}
            disabled={!canResolve}
            onPick={() => setPendingAction('resolve-yes')}
            onConfirm={() => mutate.mutate('resolve-yes')}
            mutating={mutate.isPending}
          />
          <ActionBtn
            label="Resolve NO"
            variant="no"
            pending={pendingAction === 'resolve-no'}
            disabled={!canResolve}
            onPick={() => setPendingAction('resolve-no')}
            onConfirm={() => mutate.mutate('resolve-no')}
            mutating={mutate.isPending}
          />
          <ActionBtn
            label="Resolve INVALID"
            variant="secondary"
            pending={pendingAction === 'resolve-invalid'}
            disabled={!canResolve}
            onPick={() => setPendingAction('resolve-invalid')}
            onConfirm={() => mutate.mutate('resolve-invalid')}
            mutating={mutate.isPending}
          />
        </div>

        <div className="space-y-2">
          <CardSubtitle>Void (refunds cost basis):</CardSubtitle>
          <input
            type="text"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="reason for void"
            className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <ActionBtn
            label="Void market"
            variant="danger"
            pending={pendingAction === 'void'}
            disabled={!canResolve || !voidReason}
            onPick={() => setPendingAction('void')}
            onConfirm={() => mutate.mutate('void')}
            mutating={mutate.isPending}
          />
        </div>
      </Card>
    </div>
  );
}

function ActionBtn({
  label,
  variant,
  pending,
  disabled,
  onPick,
  onConfirm,
  mutating,
}: {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'yes' | 'no';
  pending: boolean;
  disabled: boolean;
  onPick: () => void;
  onConfirm: () => void;
  mutating: boolean;
}): JSX.Element {
  if (!pending) {
    return (
      <Button size="sm" variant={variant ?? 'primary'} disabled={disabled} onClick={onPick}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-2 py-1">
      <span className="text-xs text-slate-200">{label}?</span>
      <Button size="sm" variant={variant ?? 'primary'} onClick={onConfirm} disabled={mutating}>
        {mutating ? '…' : 'Confirm'}
      </Button>
    </span>
  );
}
