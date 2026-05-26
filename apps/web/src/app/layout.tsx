import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { QueryProvider } from '@/lib/query-provider';
import { TopNav } from '@/components/top-nav';
import { SlipProvider } from '@/lib/slip';
import { BetSlip } from '@/components/bet-slip';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Crossbar',
  description: 'Peer-to-peer prediction market for major US sports',
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} dark`}>
      <body className="min-h-screen bg-slate-950 text-slate-50 antialiased font-sans">
        <QueryProvider>
          <AuthProvider>
            <SlipProvider>
              <TopNav />
              <main className="mx-auto max-w-7xl px-4 py-6 has-slip">{children}</main>
              <BetSlip />
            </SlipProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
