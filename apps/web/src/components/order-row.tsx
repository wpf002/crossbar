'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Order } from '@/lib/types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

export function OrderRow({ order }: { order: Order }): JSX.Element {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: () => api.cancelOrder(order.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-orders'] });
      qc.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) setErr(e.message);
      else setErr('Cancel failed');
    },
  });

  const cancelable = order.status === 'OPEN' || order.status === 'PARTIAL';

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/40 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={order.side === 'BUY' ? 'yes' : 'no'}>{order.side}</Badge>
          <Badge tone={order.outcome === 'YES' ? 'yes' : 'no'}>{order.outcome}</Badge>
          <span className="qty tabular text-slate-200">
            {order.quantity}@<span className="text-slate-50">${(order.price / 100).toFixed(2)}</span>
          </span>
          <span className={cn('text-xs font-medium', statusTone(order.status))}>
            {order.status === 'PARTIAL'
              ? `PARTIAL ${order.filled}/${order.quantity}`
              : order.status}
          </span>
        </div>
        {err && <p className="mt-1 text-xs text-no">{err}</p>}
      </div>
      {cancelable && (
        <Button
          variant="danger"
          size="sm"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          {cancel.isPending ? '…' : 'Cancel'}
        </Button>
      )}
    </div>
  );
}

function statusTone(status: Order['status']): string {
  switch (status) {
    case 'FILLED':
      return 'text-yes';
    case 'CANCELED':
      return 'text-slate-500';
    case 'PARTIAL':
      return 'text-live';
    default:
      return 'text-slate-400';
  }
}
