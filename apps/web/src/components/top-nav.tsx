'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { WalletPill } from './wallet-pill';
import { cn } from '@/lib/cn';
import { Crosshair } from 'lucide-react';

export function TopNav(): JSX.Element {
  const { user, logout, loading } = useAuth();
  const pathname = usePathname() ?? '/';

  const tabs = [
    { href: '/', label: 'Markets', match: (p: string) => p === '/' || p.startsWith('/markets') },
    { href: '/portfolio', label: 'Portfolio', match: (p: string) => p.startsWith('/portfolio') },
    { href: '/leaderboard', label: 'Leaderboard', match: (p: string) => p.startsWith('/leaderboard') },
    { href: '/bots', label: 'Bots', match: (p: string) => p.startsWith('/bots') },
    ...(user?.isAdmin
      ? [{ href: '/admin', label: 'Admin', match: (p: string) => p.startsWith('/admin') }]
      : []),
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Crosshair className="h-5 w-5 text-brand" />
            <span>Crossbar</span>
          </Link>
          <nav className="hidden gap-1 sm:flex">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  t.match(pathname)
                    ? 'bg-slate-800 text-slate-50'
                    : 'text-slate-400 hover:text-slate-100',
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <WalletPill />
          {loading ? null : user ? (
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-slate-400 sm:inline">@{user.username}</span>
              <Button variant="ghost" size="sm" onClick={logout}>
                Log out
              </Button>
            </div>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Log in
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Sign up</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
