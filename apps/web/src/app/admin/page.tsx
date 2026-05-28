'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import { formatDollars } from '@/lib/format';

export default function AdminHome(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.adminStats(),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Front Office</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Open markets"
          value={data ? String(data.marketsByStatus.OPEN ?? 0) : '—'}
          loading={isLoading}
        />
        <Stat
          label="Resolved"
          value={data ? String(data.marketsByStatus.RESOLVED ?? 0) : '—'}
          loading={isLoading}
        />
        <Stat
          label="Users"
          value={data ? String(data.userCount) : '—'}
          loading={isLoading}
        />
        <Stat
          label="24h volume"
          value={data ? formatDollars(data.volume24h) : '—'}
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NavCard
          href="/admin/markets"
          title="Markets"
          subtitle="List, create, resolve, void."
        />
        <NavCard
          href="/admin/events"
          title="Events"
          subtitle="View and finalize game results."
        />
        <NavCard
          href="/admin/users"
          title="Users"
          subtitle="Wallet topups, audit account state."
        />
        <NavCard
          href="/admin/calibration"
          title="Calibration"
          subtitle="Closing prices vs outcomes, Brier scores."
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}): JSX.Element {
  return (
    <Card className="p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={`money tabular mt-1 text-xl font-bold text-slate-50 ${
          loading ? 'animate-pulse' : ''
        }`}
      >
        {value}
      </div>
    </Card>
  );
}

function NavCard({
  href,
  title,
  subtitle,
}: {
  href: string;
  title: string;
  subtitle: string;
}): JSX.Element {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-slate-700">
        <CardTitle>{title}</CardTitle>
        <CardSubtitle className="mt-2">{subtitle}</CardSubtitle>
      </Card>
    </Link>
  );
}
