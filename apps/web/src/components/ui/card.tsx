import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-800 bg-slate-900/40 p-4',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('mb-3', className)} {...rest} />;
}

export function CardTitle({
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>): JSX.Element {
  return (
    <h3
      className={cn('text-base font-semibold text-slate-100', className)}
      {...rest}
    />
  );
}

export function CardSubtitle({
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>): JSX.Element {
  return <p className={cn('text-xs text-slate-400', className)} {...rest} />;
}
