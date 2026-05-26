'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function AdminLayout({ children }: { children: ReactNode }): JSX.Element | null {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (!user.isAdmin) router.replace('/');
  }, [loading, user, router]);

  if (loading || !user || !user.isAdmin) return null;
  return <>{children}</>;
}
