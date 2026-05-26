import { cn } from '@/lib/cn';

interface Props {
  team: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Compact team mark: 2-letter monogram in a tinted square.
 * Color is derived from a stable hash of the team name so each franchise
 * gets a consistent hue without needing a real logo asset.
 */
export function TeamMark({ team, size = 'md', className }: Props): JSX.Element {
  const initials = computeInitials(team);
  const hue = hashHue(team);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center justify-center rounded-md font-bold text-white/90',
        size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-xs',
        className,
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 28%), hsl(${(hue + 30) % 360} 60% 18%))`,
        boxShadow: `inset 0 0 0 1px hsla(${hue}, 50%, 55%, 0.35)`,
      }}
    >
      {initials}
    </span>
  );
}

function computeInitials(team: string): string {
  const words = team.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
