'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { usePriceFlash } from '@/lib/use-price-flash';

type Tone = 'yes' | 'no' | 'neutral';

interface Props {
  /** Top line — typically the line value ("+1.5", "O 8.5", "YES") */
  label: string;
  /** Bottom-prominent line — the cent price (1-99) */
  price: number | null;
  /** Tiny third line — liquidity at this price */
  liquidity?: number | null;
  tone?: Tone;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

const TONE: Record<Tone, { ring: string; price: string; selectedBg: string }> = {
  yes: {
    ring: 'hover:border-yes/40',
    price: 'text-yes',
    selectedBg: 'bg-yes-tint border-yes/60',
  },
  no: {
    ring: 'hover:border-no/40',
    price: 'text-no',
    selectedBg: 'bg-no-tint border-no/60',
  },
  neutral: {
    ring: 'hover:border-slate-600',
    price: 'text-slate-100',
    selectedBg: 'bg-slate-800 border-slate-600',
  },
};

export function PriceButton({
  label,
  price,
  liquidity,
  tone = 'neutral',
  selected,
  disabled,
  onClick,
  className,
}: Props): JSX.Element {
  const flash = usePriceFlash(price);
  const t = TONE[tone];
  const isEmpty = price == null;

  // Bridge animations between prop-driven flash and class-based one-shot.
  const [animClass, setAnimClass] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    setAnimClass(flash === 'up' ? 'animate-price-flash-up' : 'animate-price-flash-down');
    const id = window.setTimeout(() => setAnimClass(null), 700);
    return () => window.clearTimeout(id);
  }, [flash]);

  return (
    <button
      type="button"
      disabled={disabled || isEmpty}
      onClick={onClick}
      className={cn(
        'group relative flex w-full flex-col items-stretch rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-left transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-brand/40',
        t.ring,
        selected && t.selectedBg,
        (disabled || isEmpty) && 'cursor-not-allowed opacity-50',
        animClass,
        className,
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className={cn('price text-lg font-bold leading-tight', t.price)}>
        {isEmpty || price == null ? '—' : `$${(price / 100).toFixed(2)}`}
      </span>
      {liquidity != null && liquidity > 0 && (
        <span className="qty text-[10px] uppercase tracking-wider text-slate-500">
          liq {formatCompact(liquidity)}
        </span>
      )}
    </button>
  );
}

function formatCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
