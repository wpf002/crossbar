'use client';

import type { SportId } from '@/lib/types';
import { cn } from '@/lib/cn';

const ALL: { id: 'ALL' | SportId; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'mlb', label: 'MLB' },
  { id: 'nfl', label: 'NFL' },
  { id: 'nba', label: 'NBA' },
  { id: 'nhl', label: 'NHL' },
];

export function SportTabs({
  value,
  onChange,
}: {
  value: 'ALL' | SportId;
  onChange: (v: 'ALL' | SportId) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 pb-2">
      {ALL.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            'whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors',
            value === t.id
              ? 'bg-brand text-slate-950'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
