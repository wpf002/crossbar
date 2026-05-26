import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  return (
    <label htmlFor={inputId} className="block">
      {label && (
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'block w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 placeholder-slate-600 focus:border-brand focus:ring-1 focus:ring-brand tabular',
          error && 'border-no/60 focus:border-no focus:ring-no',
          className,
        )}
        {...rest}
      />
      {error ? (
        <span className="mt-1 block text-xs text-no">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
});
