'use client';

import type { OrderBookLevel, OrderBookSnapshot, Outcome } from '@/lib/types';
import { cn } from '@/lib/cn';

interface Props {
  snapshot: OrderBookSnapshot | undefined;
  onPickPrice?: (outcome: Outcome, price: number, side: 'BUY' | 'SELL') => void;
}

export function OrderBookView({ snapshot, onPickPrice }: Props): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <SideBook
        title="YES"
        outcome="YES"
        bids={snapshot?.yesBids ?? []}
        asks={snapshot?.yesAsks ?? []}
        onPickPrice={onPickPrice}
      />
      <SideBook
        title="NO"
        outcome="NO"
        bids={snapshot?.noBids ?? []}
        asks={snapshot?.noAsks ?? []}
        onPickPrice={onPickPrice}
      />
    </div>
  );
}

function SideBook({
  title,
  outcome,
  bids,
  asks,
  onPickPrice,
}: {
  title: string;
  outcome: Outcome;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  onPickPrice?: (outcome: Outcome, price: number, side: 'BUY' | 'SELL') => void;
}): JSX.Element {
  const maxBidQty = Math.max(1, ...bids.map((l) => l.quantity));
  const maxAskQty = Math.max(1, ...asks.map((l) => l.quantity));
  const best = bids[0]?.price ?? null;
  const askBest = asks[0]?.price ?? null;
  const spread = best != null && askBest != null ? askBest - best : null;
  const mid = best != null && askBest != null ? Math.round((best + askBest) / 2) : best ?? askBest;

  return (
    <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className={cn('text-xs font-bold uppercase tracking-wider', outcome === 'YES' ? 'text-yes' : 'text-no')}>
          {title}
        </span>
        <span className="text-[11px] text-slate-500">
          {mid != null ? `mid $${(mid / 100).toFixed(2)}` : '—'}
          {spread != null && ` · $${(spread / 100).toFixed(2)} spread`}
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-slate-800">
        <BookSide
          label="Bids"
          levels={bids.slice(0, 20)}
          maxQty={maxBidQty}
          tone="bid"
          onClick={(p) => onPickPrice?.(outcome, p, 'SELL')}
        />
        <BookSide
          label="Asks"
          levels={asks.slice(0, 20)}
          maxQty={maxAskQty}
          tone="ask"
          onClick={(p) => onPickPrice?.(outcome, p, 'BUY')}
        />
      </div>
    </div>
  );
}

function BookSide({
  label,
  levels,
  maxQty,
  tone,
  onClick,
}: {
  label: string;
  levels: OrderBookLevel[];
  maxQty: number;
  tone: 'bid' | 'ask';
  onClick?: (price: number) => void;
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        <span>qty</span>
      </div>
      <div className="divide-y divide-slate-900">
        {levels.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-600">Empty</div>
        ) : (
          levels.map((lvl) => {
            const widthPct = Math.round((lvl.quantity / maxQty) * 100);
            return (
              <button
                key={lvl.price}
                type="button"
                onClick={() => onClick?.(lvl.price)}
                className="relative block w-full overflow-hidden px-3 py-1 text-left text-xs text-slate-200 hover:bg-slate-800/50"
              >
                <span
                  className={cn(
                    'absolute inset-y-0 left-0',
                    tone === 'bid' ? 'bg-yes/15' : 'bg-no/15',
                  )}
                  style={{ width: `${widthPct}%` }}
                />
                <span className="relative flex justify-between">
                  <span className={cn('price font-bold tabular', tone === 'bid' ? 'text-yes' : 'text-no')}>
                    ${(lvl.price / 100).toFixed(2)}
                  </span>
                  <span className="qty tabular text-slate-400">{lvl.quantity}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
