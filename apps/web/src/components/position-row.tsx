'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { Position } from '@/lib/types';
import { api } from '@/lib/api';
import { formatDollars, formatPrice } from '@/lib/format';
import { Badge } from './ui/badge';
import { Sparkline } from './sparkline';
import { cn } from '@/lib/cn';

export function PositionRow({ position }: { position: Position }): JSX.Element {
  const sparkQ = useQuery({
    queryKey: ['candles', position.marketId, 'pos-spark'],
    queryFn: () => api.marketCandles(position.marketId, { hours: 24, bucket: 60 * 60_000 }),
    staleTime: 60_000,
  });
  const spark = sparkQ.data?.candles.map((c) => c.c) ?? [];

  const last = position.lastTradePrice ?? null;
  const yesValue = last != null ? position.yesShares * last : position.yesShares * (position.avgYesCost ?? 0);
  const noValue =
    last != null ? position.noShares * (100 - last) : position.noShares * (position.avgNoCost ?? 0);
  const currentValue = yesValue + noValue;
  const cost =
    position.yesShares * (position.avgYesCost ?? 0) +
    position.noShares * (position.avgNoCost ?? 0);
  const unrealized = currentValue - cost;

  return (
    <Link
      href={`/markets/${position.marketId}`}
      className="block rounded-md border border-slate-800 bg-slate-900/40 p-3 transition-colors hover:border-slate-700 hover:bg-slate-900/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{position.market.type}</Badge>
            <span className="truncate text-sm font-medium text-slate-100">
              {position.market.question}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {position.yesShares > 0 && (
              <span>
                <span className="font-semibold text-yes">YES</span>{' '}
                <span className="qty tabular text-slate-200">{position.yesShares}</span>
                {position.avgYesCost != null && (
                  <span className="ml-1 text-slate-500">@{formatPrice(position.avgYesCost)}</span>
                )}
              </span>
            )}
            {position.noShares > 0 && (
              <span>
                <span className="font-semibold text-no">NO</span>{' '}
                <span className="qty tabular text-slate-200">{position.noShares}</span>
                {position.avgNoCost != null && (
                  <span className="ml-1 text-slate-500">@{formatPrice(position.avgNoCost)}</span>
                )}
              </span>
            )}
            <span>Last {formatPrice(last)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {spark.length >= 2 && <Sparkline points={spark} width={70} height={26} />}
          <div className="text-right">
            <div className="money tabular text-sm font-bold text-slate-100">
              {formatDollars(currentValue)}
            </div>
            <div
              className={cn(
                'money tabular text-xs font-semibold',
                unrealized > 0
                  ? 'text-yes'
                  : unrealized < 0
                    ? 'text-no'
                    : 'text-slate-500',
              )}
            >
              {unrealized >= 0 ? '+' : ''}
              {formatDollars(unrealized)}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
