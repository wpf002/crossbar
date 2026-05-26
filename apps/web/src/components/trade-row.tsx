import type { Trade } from '@/lib/types';
import { cn } from '@/lib/cn';

export function TradeRow({ trade }: { trade: Trade }): JSX.Element {
  const time = new Date(trade.createdAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  return (
    <div className="grid grid-cols-4 items-center px-3 py-1.5 text-xs">
      <span className="tabular text-slate-500">{time}</span>
      <span
        className={cn(
          'font-bold',
          trade.outcome === 'YES' ? 'text-yes' : 'text-no',
        )}
      >
        {trade.outcome}
      </span>
      <span className="price tabular text-slate-200">${(trade.price / 100).toFixed(2)}</span>
      <span className="qty tabular text-right text-slate-400">{trade.quantity}</span>
    </div>
  );
}
