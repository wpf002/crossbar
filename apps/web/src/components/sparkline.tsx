'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Auto-color based on first vs last; override with `tone`. */
  tone?: 'yes' | 'no' | 'neutral' | 'auto';
}

export function Sparkline({
  points,
  width = 120,
  height = 28,
  className,
  tone = 'auto',
}: Props): JSX.Element | null {
  const id = useId();
  if (points.length < 2) {
    return (
      <div
        className={cn('inline-block text-slate-600', className)}
        style={{ width, height }}
        aria-hidden
      />
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);

  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p - min) / span) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const resolvedTone =
    tone === 'auto' ? (last >= first ? 'yes' : 'no') : tone;
  const stroke =
    resolvedTone === 'yes' ? '#4ade80' : resolvedTone === 'no' ? '#f87171' : '#64748b';
  const fill = `url(#sparkfill-${id})`;

  const areaPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label="Price history sparkline"
    >
      <defs>
        <linearGradient id={`sparkfill-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={fill} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
