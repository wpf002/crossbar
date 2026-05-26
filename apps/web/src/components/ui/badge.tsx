import { cn } from '@/lib/cn';
import type { HTMLAttributes } from 'react';

type Tone = 'neutral' | 'brand' | 'yes' | 'no' | 'success' | 'danger' | 'warning' | 'live';

const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-slate-800 text-slate-300',
  brand: 'bg-cyan-950 text-brand ring-1 ring-inset ring-brand/30',
  yes: 'bg-yes-tint text-yes ring-1 ring-inset ring-yes/30',
  no: 'bg-no-tint text-no ring-1 ring-inset ring-no/30',
  success: 'bg-green-950 text-green-300 ring-1 ring-inset ring-green-700/40',
  danger: 'bg-red-950 text-red-300 ring-1 ring-inset ring-red-700/40',
  warning: 'bg-amber-950 text-amber-200 ring-1 ring-inset ring-amber-700/40',
  live: 'bg-live-tint text-live ring-1 ring-inset ring-live/40',
};

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        TONE_STYLES[tone],
        className,
      )}
      {...rest}
    />
  );
}
