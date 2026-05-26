'use client';

import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import Cookies from 'js-cookie';
import { TOKEN_COOKIE } from './api';
import { useAuth } from './auth';
import type {
  MarketListItem,
  Order,
  OrderBookSnapshot,
  Position,
  Trade,
  Wallet,
} from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Pattern: SSE hooks update the TanStack Query cache directly. Pages keep
 * their `useQuery(...)` for the first-paint data and stay otherwise unaware
 * of SSE. Each hook owns one EventSource for the duration of its mount.
 */

interface SseHandler {
  event: string;
  onMessage: (parsed: unknown) => void;
}

/** Type-safe constructor for handlers; the parsed payload is narrowed at the call site. */
function on<T>(event: string, onMessage: (parsed: T) => void): SseHandler {
  return { event, onMessage: onMessage as (parsed: unknown) => void };
}

function openEventSource(url: string, handlers: ReadonlyArray<SseHandler>): EventSource {
  const es = new EventSource(url);
  for (const h of handlers) {
    es.addEventListener(h.event, (e: MessageEvent) => {
      try {
        h.onMessage(JSON.parse(e.data));
      } catch {
        // ignore parse errors
      }
    });
  }
  return es;
}

// ─── Market detail: book + trades ────────────────────────────────────────
export function useMarketStream(marketId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!marketId) return;
    const es = openEventSource(`${BASE_URL}/sse/markets/${marketId}`, [
      on<OrderBookSnapshot>('book', (snap) => {
        qc.setQueryData(['book', marketId], snap);
      }),
      on<Trade>('trade', (trade) => {
        patchTradesCache(qc, marketId, trade);
        patchMarketLastTrade(qc, marketId, trade);
      }),
    ]);
    return () => es.close();
  }, [marketId, qc]);
}

// ─── Markets list: lastTrade ticker ──────────────────────────────────────
export function useMarketsListStream(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const es = openEventSource(`${BASE_URL}/sse/markets`, [
      on<{ marketId: string; price: number }>('lastTrade', ({ marketId, price }) => {
        patchListCacheLastTrade(qc, marketId, price);
      }),
    ]);
    return () => es.close();
  }, [qc]);
}

// ─── /me stream: wallet + positions + orders ─────────────────────────────
export function useMeStream(): void {
  const qc = useQueryClient();
  const { token } = useAuth();
  useEffect(() => {
    const t = token ?? Cookies.get(TOKEN_COOKIE);
    if (!t) return;
    const es = openEventSource(`${BASE_URL}/sse/me?token=${encodeURIComponent(t)}`, [
      on<{ balance: number; reserved: number }>('wallet', (w) => {
        const next: Wallet = {
          balance: w.balance,
          reserved: w.reserved,
          available: w.balance,
        };
        qc.setQueryData(['wallet', t], next);
      }),
      on<SsePosition>('position', (p) => {
        patchPositionsCache(qc, t, p);
      }),
      on<Order>('order', (o) => {
        patchOrdersCache(qc, t, o);
      }),
    ]);
    return () => es.close();
  }, [qc, token]);
}

// ─── Cache patching helpers ──────────────────────────────────────────────

function patchTradesCache(qc: QueryClient, marketId: string, trade: Trade): void {
  qc.setQueryData<{ trades: Trade[]; limit: number; offset: number } | undefined>(
    ['trades', marketId],
    (prev) => {
      if (!prev) return prev;
      // Prepend, dedupe by id, cap at the existing limit.
      const next = [trade, ...prev.trades.filter((t) => t.id !== trade.id)];
      return { ...prev, trades: next.slice(0, prev.limit) };
    },
  );
}

function patchMarketLastTrade(qc: QueryClient, marketId: string, trade: Trade): void {
  qc.setQueryData<
    | (Omit<MarketListItem, 'lastTradePrice'> & {
        lastTrade: { price: number; at: string } | null;
      })
    | undefined
  >(['market', marketId], (prev) => {
    if (!prev) return prev;
    return { ...prev, lastTrade: { price: trade.price, at: trade.createdAt } };
  });
}

function patchListCacheLastTrade(qc: QueryClient, marketId: string, price: number): void {
  // Update all variants of ['markets', sport] currently cached.
  const queries = qc.getQueriesData<MarketListItem[]>({ queryKey: ['markets'] });
  for (const [key, data] of queries) {
    if (!data) continue;
    qc.setQueryData<MarketListItem[]>(key, (prev) =>
      (prev ?? []).map((m) => (m.id === marketId ? { ...m, lastTradePrice: price } : m)),
    );
  }
}

interface SsePosition {
  marketId: string;
  yesShares: number;
  noShares: number;
  avgYesCost: number | null;
  avgNoCost: number | null;
  realizedPnl: number;
}

function patchPositionsCache(qc: QueryClient, token: string, p: SsePosition): void {
  qc.setQueryData<Position[]>(['positions', token], (prev) => {
    if (!prev) return prev;
    const idx = prev.findIndex((row) => row.marketId === p.marketId);
    if (idx === -1) {
      // New position — we don't have the market brief, so leave list alone;
      // a background refetch will pick it up. (TanStack Query's
      // refetchOnReconnect / interval keeps us honest.)
      return prev;
    }
    const next = [...prev];
    next[idx] = {
      ...next[idx]!,
      yesShares: p.yesShares,
      noShares: p.noShares,
      avgYesCost: p.avgYesCost,
      avgNoCost: p.avgNoCost,
      realizedPnl: p.realizedPnl,
    };
    return next;
  });
}

function patchOrdersCache(qc: QueryClient, token: string, o: Order): void {
  // Open orders list ("my-orders", "open", token) — replace/insert/remove
  qc.setQueryData<{ orders: Order[]; limit: number; offset: number } | undefined>(
    ['my-orders', 'open', token],
    (prev) => {
      if (!prev) return prev;
      const isOpen = o.status === 'OPEN' || o.status === 'PARTIAL';
      const without = prev.orders.filter((x) => x.id !== o.id);
      const next = isOpen ? [o, ...without] : without;
      return { ...prev, orders: next };
    },
  );
}
