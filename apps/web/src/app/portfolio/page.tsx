'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMeStream } from '@/lib/sse';
import type { Position } from '@/lib/types';
import { Card, CardSubtitle } from '@/components/ui/card';
import { OrderRow } from '@/components/order-row';
import { PositionRow } from '@/components/position-row';
import { TradeRow } from '@/components/trade-row';
import { EquityChart } from '@/components/equity-chart';
import { formatDollars } from '@/lib/format';
import { cn } from '@/lib/cn';

type Tab = 'positions' | 'orders' | 'trades';

export default function PortfolioPage(): JSX.Element | null {
  const router = useRouter();
  const { token, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('positions');

  useEffect(() => {
    if (!loading && !token) router.replace('/login');
  }, [loading, token, router]);

  useMeStream();

  // 30s safety refetch — SSE keeps these caches hot in normal operation.
  const ordersQ = useQuery({
    queryKey: ['my-orders', 'open', token],
    queryFn: () => api.myOrders({ status: 'OPEN,PARTIAL', limit: 50 }),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const positionsQ = useQuery({
    queryKey: ['positions', token],
    queryFn: () => api.positions(),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const tradesQ = useQuery({
    queryKey: ['my-trades', token],
    queryFn: () => api.myTrades({ limit: 50 }),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const walletQ = useQuery({
    queryKey: ['wallet', token],
    queryFn: () => api.wallet(),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const stats = useMemo(() => computeStats(positionsQ.data ?? [], walletQ.data?.balance ?? 0), [positionsQ.data, walletQ.data]);

  if (loading || !token) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>

      <EquityChart />

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Net worth"
          value={formatDollars(stats.netWorth)}
        />
        <StatCard
          label="Cash"
          value={walletQ.data ? formatDollars(walletQ.data.balance) : '—'}
        />
        <StatCard
          label="Position value"
          value={formatDollars(stats.positionValue)}
        />
        <StatCard
          label="Unrealized P&L"
          value={`${stats.unrealized >= 0 ? '+' : ''}${formatDollars(stats.unrealized)}`}
          tone={stats.unrealized > 0 ? 'yes' : stats.unrealized < 0 ? 'no' : 'neutral'}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-800">
        <nav className="flex gap-1">
          <TabButton tab="positions" active={tab} onClick={setTab} count={positionsQ.data?.length} />
          <TabButton tab="orders" active={tab} onClick={setTab} count={ordersQ.data?.orders.length} />
          <TabButton tab="trades" active={tab} onClick={setTab} count={tradesQ.data?.trades.length} />
        </nav>
      </div>

      {tab === 'positions' && (
        <section className="space-y-2">
          {positionsQ.data?.length === 0 ? (
            <Card>
              <CardSubtitle>No positions yet — find a market and place an order.</CardSubtitle>
            </Card>
          ) : (
            positionsQ.data?.map((p) => <PositionRow key={p.marketId} position={p} />)
          )}
        </section>
      )}

      {tab === 'orders' && (
        <section className="space-y-2">
          {ordersQ.data?.orders.length === 0 ? (
            <Card>
              <CardSubtitle>No open orders.</CardSubtitle>
            </Card>
          ) : (
            ordersQ.data?.orders.map((o) => <OrderRow key={o.id} order={o} />)
          )}
        </section>
      )}

      {tab === 'trades' && (
        <Card className="p-0">
          {tradesQ.data?.trades.length === 0 ? (
            <CardSubtitle className="p-4">No trades yet.</CardSubtitle>
          ) : (
            <div className="divide-y divide-slate-900">
              <div className="grid grid-cols-4 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Time</span>
                <span>Side</span>
                <span>Price</span>
                <span className="text-right">Qty</span>
              </div>
              {tradesQ.data?.trades.map((t) => <TradeRow key={t.id} trade={t} />)}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'yes' | 'no' | 'neutral';
}): JSX.Element {
  return (
    <Card className="p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={cn(
          'money tabular mt-1 text-xl font-bold',
          tone === 'yes' && 'text-yes',
          tone === 'no' && 'text-no',
          tone === 'neutral' && 'text-slate-50',
        )}
      >
        {value}
      </div>
    </Card>
  );
}

function TabButton({
  tab,
  active,
  onClick,
  count,
}: {
  tab: Tab;
  active: Tab;
  onClick: (t: Tab) => void;
  count?: number;
}): JSX.Element {
  const label = tab.charAt(0).toUpperCase() + tab.slice(1);
  return (
    <button
      type="button"
      onClick={() => onClick(tab)}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
        active === tab
          ? 'border-brand text-slate-50'
          : 'border-transparent text-slate-500 hover:text-slate-200',
      )}
    >
      {label}
      {count != null && (
        <span className="ml-1.5 inline-flex items-center rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-400">
          {count}
        </span>
      )}
    </button>
  );
}

function computeStats(
  positions: Position[],
  cash: number,
): {
  netWorth: number;
  positionValue: number;
  unrealized: number;
} {
  let positionValue = 0;
  let cost = 0;
  for (const p of positions) {
    const last = p.lastTradePrice ?? null;
    const yesV = last != null ? p.yesShares * last : p.yesShares * (p.avgYesCost ?? 0);
    const noV = last != null ? p.noShares * (100 - last) : p.noShares * (p.avgNoCost ?? 0);
    positionValue += yesV + noV;
    cost += p.yesShares * (p.avgYesCost ?? 0) + p.noShares * (p.avgNoCost ?? 0);
  }
  return {
    netWorth: cash + positionValue,
    positionValue,
    unrealized: positionValue - cost,
  };
}
