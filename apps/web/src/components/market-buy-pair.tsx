'use client';

import type { MarketDetail, OrderBookSnapshot } from '@/lib/types';
import { useSlip } from '@/lib/slip';
import { cn } from '@/lib/cn';

interface Props {
  market: MarketDetail;
  snapshot: OrderBookSnapshot | undefined;
}

/**
 * The Kalshi/Polymarket-style headline "Buy YES / Buy NO" pair —
 * two large buttons showing the implied probability of each outcome.
 * Clicking one stages a BUY in the slip at the current best ask.
 */
export function MarketBuyPair({ market, snapshot }: Props): JSX.Element {
  const { setLeg } = useSlip();

  const yesAsk = snapshot?.yesAsks[0]?.price ?? null;
  const yesBid = snapshot?.yesBids[0]?.price ?? null;
  const yesMid = yesAsk != null && yesBid != null ? Math.round((yesAsk + yesBid) / 2) : (yesAsk ?? yesBid ?? null);

  const noAsk = snapshot?.noAsks[0]?.price ?? null;
  const noBid = snapshot?.noBids[0]?.price ?? null;
  const noMid = noAsk != null && noBid != null ? Math.round((noAsk + noBid) / 2) : (noAsk ?? noBid ?? null);

  const stage = (outcome: 'YES' | 'NO'): void => {
    const ask = outcome === 'YES' ? yesAsk : noAsk;
    const last = market.lastTrade?.price ?? null;
    const fallback = outcome === 'YES' ? (yesMid ?? 50) : (noMid ?? 50);
    const price = ask ?? last ?? fallback;
    setLeg({
      marketId: market.id,
      marketLabel: `${market.event.awayTeam} @ ${market.event.homeTeam} · ${market.type}`,
      outcome,
      side: 'BUY',
      price,
      quantity: 10,
    });
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <BigButton
        tone="yes"
        label={market.yesLabel}
        price={yesMid}
        onClick={() => stage('YES')}
      />
      <BigButton
        tone="no"
        label={market.noLabel}
        price={noMid}
        onClick={() => stage('NO')}
      />
    </div>
  );
}

function BigButton({
  tone,
  label,
  price,
  onClick,
}: {
  tone: 'yes' | 'no';
  label: string;
  price: number | null;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={price == null}
      className={cn(
        'group flex flex-col items-start rounded-lg border px-4 py-3 text-left transition-all',
        tone === 'yes'
          ? 'border-yes/30 bg-yes-tint hover:border-yes/60 hover:bg-yes/20'
          : 'border-no/30 bg-no-tint hover:border-no/60 hover:bg-no/20',
        price == null && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'text-[10px] font-bold uppercase tracking-wider',
          tone === 'yes' ? 'text-yes' : 'text-no',
        )}
      >
        Buy {tone.toUpperCase()}
      </span>
      <span className="mt-1 truncate text-sm font-semibold text-slate-100">
        {label}
      </span>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn('price text-2xl font-bold', tone === 'yes' ? 'text-yes' : 'text-no')}>
          {price != null ? `$${(price / 100).toFixed(2)}` : '—'}
        </span>
        {price != null && (
          <span className="text-xs text-slate-500">{price}% prob</span>
        )}
      </div>
    </button>
  );
}
