/** Format cents as $X.YZ. */
export function formatDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString()}.${remainder.toString().padStart(2, '0')}`;
}

/** Format a price (integer cents-per-share, 1-99) as "$0.60". */
export function formatPrice(price: number | null | undefined): string {
  if (price == null) return '—';
  return `$${(price / 100).toFixed(2)}`;
}

/** Implied probability for display: 60¢ → "60%". */
export function formatProb(price: number | null | undefined): string {
  if (price == null) return '—';
  return `${price}%`;
}

export function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((t - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return diffSec >= 0 ? 'in <1m' : 'just now';
  if (abs < 3600) {
    const m = Math.round(abs / 60);
    return diffSec >= 0 ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < 86400) {
    const h = Math.round(abs / 3600);
    return diffSec >= 0 ? `in ${h}h` : `${h}h ago`;
  }
  const d = Math.round(abs / 86400);
  return diffSec >= 0 ? `in ${d}d` : `${d}d ago`;
}

export function formatGameTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
