'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, MessageCircle, Users } from 'lucide-react';
import type { MarketListItem, MarketType } from '@/lib/types';
import { cn } from '@/lib/cn';
import { formatGameTime } from '@/lib/format';
import { PriceButton } from './price-button';
import { TeamMark } from './team-mark';
import { Sparkline } from './sparkline';
import { useSlip } from '@/lib/slip';
import { Badge } from './ui/badge';

interface Props {
  /** All markets belonging to ONE event, pre-sorted MONEYLINE/SPREAD/TOTAL. */
  markets: MarketListItem[];
  /** Optional sparkline points for the moneyline (YES). */
  spark?: number[];
}

const TYPE_ORDER: Record<MarketType, number> = {
  SPREAD: 0,
  TOTAL: 1,
  MONEYLINE: 2,
  PLAYER_TOTAL: 3,
};

export function GameRow({ markets, spark }: Props): JSX.Element | null {
  const router = useRouter();
  const { setLeg } = useSlip();
  if (markets.length === 0) return null;

  const sorted = [...markets].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
  const ev = sorted[0]!.event;
  const sport = ev.sportId.toUpperCase();
  const isLive = ev.status === 'LIVE';
  const moneyline = sorted.find((m) => m.type === 'MONEYLINE');
  const spread = sorted.find((m) => m.type === 'SPREAD');
  const total = sorted.find((m) => m.type === 'TOTAL');

  const yesMidpoint = (m: MarketListItem | undefined): number | null => {
    if (!m) return null;
    if (m.lastTradePrice != null) return m.lastTradePrice;
    const { yesBid, yesAsk } = m.topOfBook;
    if (yesBid != null && yesAsk != null) return Math.round((yesBid + yesAsk) / 2);
    return yesBid ?? yesAsk ?? null;
  };

  // Total volume across the event's 3 markets (cents).
  const eventVolume = sorted.reduce((a, m) => a + (m.volume24h ?? 0), 0);
  const totalTraders = Math.max(...sorted.map((m) => m.traders ?? 0));
  const detailHref = `/markets/${moneyline?.id ?? sorted[0]!.id}`;

  return (
    <article className="group relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 transition-colors hover:border-slate-700">
      <Link
        href={detailHref}
        className="absolute inset-0 z-0"
        aria-label={`Open ${ev.awayTeam} at ${ev.homeTeam}`}
      />

      <div className="relative z-10 grid grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-6">
        {/* Left: teams + time */}
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-1 pt-1">
            <Badge tone="neutral" className="font-semibold">
              {sport}
            </Badge>
            {isLive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-live-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-live">
                <span className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-live" />
                LIVE
              </span>
            ) : ev.status === 'FINAL' ? (
              <Badge tone="neutral">FINAL</Badge>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500">
              {isLive ? 'Live now' : formatGameTime(ev.startsAt)}
            </div>
            <div className="mt-1 space-y-1">
              <TeamLine team={ev.awayTeam} />
              <TeamLine team={ev.homeTeam} />
            </div>
            <div className="mt-2 flex items-center gap-3">
              {spark && spark.length > 1 && (
                <Sparkline points={spark} width={80} height={20} />
              )}
              <span className="text-[11px] text-slate-500">
                {formatVolume(eventVolume)} traded · {totalTraders > 0 ? `${totalTraders} traders` : 'new'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: 3-column price grid */}
        <div
          className="grid grid-cols-3 gap-2 lg:w-[420px]"
          onClick={(e) => e.stopPropagation()}
        >
          <ColumnHeader label="Spread" />
          <ColumnHeader label="Total" />
          <ColumnHeader label="Moneyline" />

          <MarketColumn
            market={spread}
            yesPrice={yesMidpoint(spread)}
            yesLabel={spread ? formatSpreadLabel(spread, ev.awayTeam, ev.homeTeam) : '—'}
            onPick={(m) => quickAddLeg(m, setLeg)}
          />
          <MarketColumn
            market={total}
            yesPrice={yesMidpoint(total)}
            yesLabel={total ? `O ${total.line ?? '?'}` : '—'}
            onPick={(m) => quickAddLeg(m, setLeg)}
          />
          <MarketColumn
            market={moneyline}
            yesPrice={yesMidpoint(moneyline)}
            yesLabel={ev.homeTeam.split(' ').slice(-1)[0]!}
            onPick={(m) => quickAddLeg(m, setLeg)}
          />
        </div>
      </div>

      {/* Bottom-meta row */}
      <div className="relative z-10 flex items-center justify-between border-t border-slate-800 bg-slate-900/30 px-3 py-1.5 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> {totalTraders}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3 w-3" /> 0
          </span>
        </span>
        <button
          type="button"
          onClick={() => router.push(detailHref)}
          className="inline-flex items-center gap-1 hover:text-slate-200"
        >
          {sorted.length} market{sorted.length === 1 ? '' : 's'}
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </article>
  );
}

function TeamLine({ team }: { team: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <TeamMark team={team} size="sm" />
      <span className="truncate text-sm font-semibold text-slate-100">{team}</span>
    </div>
  );
}

function ColumnHeader({ label }: { label: string }): JSX.Element {
  return (
    <div className="px-1 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {label}
    </div>
  );
}

function MarketColumn({
  market,
  yesPrice,
  yesLabel,
  onPick,
}: {
  market: MarketListItem | undefined;
  yesPrice: number | null;
  yesLabel: string;
  onPick: (m: MarketListItem) => void;
}): JSX.Element {
  if (!market) {
    return (
      <PriceButton label="—" price={null} tone="neutral" disabled className="h-16" />
    );
  }
  const liq =
    (market.depth?.yesBidQty ?? 0) + (market.depth?.yesAskQty ?? 0) || null;
  return (
    <PriceButton
      label={yesLabel}
      price={yesPrice}
      liquidity={liq}
      tone="yes"
      onClick={() => onPick(market)}
      className="h-16"
    />
  );
}

function quickAddLeg(
  m: MarketListItem,
  setLeg: (l: import('@/lib/slip').SlipLeg) => void,
): void {
  // Default to BUY YES at the mid (or top-of-book ask, or 50¢).
  const ask = m.topOfBook.yesAsk ?? null;
  const bid = m.topOfBook.yesBid ?? null;
  const last = m.lastTradePrice ?? null;
  const price = last ?? ask ?? bid ?? 50;
  setLeg({
    marketId: m.id,
    marketLabel: `${m.event.awayTeam} @ ${m.event.homeTeam} · ${m.type}`,
    outcome: 'YES',
    side: 'BUY',
    price,
    quantity: 10,
  });
}

function formatSpreadLabel(
  market: MarketListItem,
  _away: string,
  home: string,
): string {
  if (market.line == null) return home;
  const sign = market.line > 0 ? '+' : '';
  const homeShort = home.split(' ').slice(-1)[0]!;
  return `${homeShort} ${sign}${market.line}`;
}

function formatVolume(cents: number): string {
  if (cents === 0) return 'No volume yet';
  const dollars = Math.round(cents / 100);
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars}`;
}
