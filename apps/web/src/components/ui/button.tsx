import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'yes' | 'no';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-brand text-slate-950 hover:bg-cyan-300 disabled:bg-slate-700 disabled:text-slate-500',
  secondary:
    'bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-500',
  ghost: 'bg-transparent text-slate-200 hover:bg-slate-800 disabled:text-slate-500',
  danger: 'bg-no-tint text-no hover:bg-no/20 disabled:text-slate-500',
  yes: 'bg-yes-strong text-slate-950 hover:bg-yes disabled:bg-slate-700 disabled:text-slate-500',
  no: 'bg-no-strong text-slate-50 hover:bg-no disabled:bg-slate-700 disabled:text-slate-500',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-md',
  md: 'h-10 px-4 text-sm rounded-md',
  lg: 'h-12 px-6 text-base rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
});
