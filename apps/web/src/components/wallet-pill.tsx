'use client';

import { useQuery } from '@tanstack/react-query';
import { Wallet as WalletIcon } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDollars } from '@/lib/format';

export function WalletPill(): JSX.Element | null {
  const { token } = useAuth();
  const { data } = useQuery({
    queryKey: ['wallet', token],
    queryFn: () => api.wallet(),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  if (!token) return null;

  return (
    <Link
      href="/wallet"
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-sm text-slate-200 hover:border-slate-700 hover:bg-slate-800"
    >
      <WalletIcon className="h-3.5 w-3.5 text-yes" />
      <span className="money tabular font-semibold">
        {data ? formatDollars(data.balance) : '—'}
      </span>
    </Link>
  );
}
