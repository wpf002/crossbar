'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Wallet as WalletIcon, Lock, Coins } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMeStream } from '@/lib/sse';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import { formatDollars } from '@/lib/format';

export default function WalletPage(): JSX.Element | null {
  const router = useRouter();
  const { token, loading } = useAuth();

  useEffect(() => {
    if (!loading && !token) router.replace('/login');
  }, [loading, token, router]);

  useMeStream();

  const { data, isLoading } = useQuery({
    queryKey: ['wallet', token],
    queryFn: () => api.wallet(),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  if (loading || !token) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Wallet</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Coins className="h-4 w-4 text-yes" />}
          label="Available"
          value={data ? formatDollars(data.available) : '—'}
          loading={isLoading}
          accent
        />
        <StatCard
          icon={<WalletIcon className="h-4 w-4 text-brand" />}
          label="Balance"
          value={data ? formatDollars(data.balance) : '—'}
          loading={isLoading}
        />
        <StatCard
          icon={<Lock className="h-4 w-4 text-slate-500" />}
          label="Reserved"
          value={data ? formatDollars(data.reserved) : '—'}
          loading={isLoading}
          dim
        />
      </div>

      <Card>
        <CardTitle className="text-sm">About play money</CardTitle>
        <CardSubtitle className="mt-2 leading-relaxed">
          Every new account starts with $1,000 of play money. <span className="text-slate-300">Reserved</span>{' '}
          funds are tied up in open BUY orders; <span className="text-slate-300">Available</span> funds are
          free to spend. Cancelling an order releases its reservation immediately. Real-money support is a
          future-phase change.
        </CardSubtitle>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
  dim,
  accent,
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  loading?: boolean;
  dim?: boolean;
  accent?: boolean;
}): JSX.Element {
  return (
    <Card>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div
        className={`money tabular mt-2 text-3xl font-bold ${
          accent ? 'text-yes' : dim ? 'text-slate-400' : 'text-slate-50'
        } ${loading ? 'animate-pulse' : ''}`}
      >
        {value}
      </div>
    </Card>
  );
}
