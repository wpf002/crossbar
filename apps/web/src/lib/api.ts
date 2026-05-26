import Cookies from 'js-cookie';
import type {
  BotsStatsResponse,
  CandleSeries,
  Comment,
  LeaderboardResponse,
  MarketDetail,
  MarketListItem,
  Order,
  OrderBookSnapshot,
  PlaceOrderRequest,
  PlaceOrderResponse,
  Position,
  PublicUser,
  SportId,
  Trade,
  Wallet,
} from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const TOKEN_COOKIE = 'crossbar_token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { json, auth, headers, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...((headers as Record<string, string> | undefined) ?? {}),
  };
  if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = Cookies.get(TOKEN_COOKIE);
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as { error?: string; message?: string };
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(
      res.status,
      body.error ?? `HTTP_${res.status}`,
      body.message ?? `Request failed: ${res.status}`,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─── Auth ─────────────────────────────────────────────────────────────────
export interface AuthResponse {
  user: PublicUser;
  token: string;
}

export const api = {
  signup: (body: { email: string; username: string; password: string }) =>
    request<AuthResponse>('/auth/signup', { method: 'POST', json: body }),

  login: (body: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', json: body }),

  me: () => request<PublicUser>('/me', { auth: true }),

  wallet: () => request<Wallet>('/me/wallet', { auth: true }),

  positions: () => request<Position[]>('/me/positions', { auth: true }),

  myOrders: (opts: { status?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ orders: Order[]; limit: number; offset: number }>(
      `/me/orders${qs ? `?${qs}` : ''}`,
      { auth: true },
    );
  },

  myTrades: (opts: { limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ trades: Trade[]; limit: number; offset: number }>(
      `/me/trades${qs ? `?${qs}` : ''}`,
      { auth: true },
    );
  },

  // ─── Markets (public) ───────────────────────────────────────────────────
  listMarkets: (opts: { sport?: SportId | SportId[]; type?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.sport) {
      const v = Array.isArray(opts.sport) ? opts.sport.join(',') : opts.sport;
      params.set('sport', v);
    }
    if (opts.type) params.set('type', opts.type);
    const qs = params.toString();
    return request<MarketListItem[]>(`/markets${qs ? `?${qs}` : ''}`);
  },

  market: (id: string) => request<MarketDetail>(`/markets/${id}`),

  marketBook: (id: string) => request<OrderBookSnapshot>(`/markets/${id}/book`),

  marketTrades: (id: string, opts: { limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return request<{ trades: Trade[]; limit: number; offset: number }>(
      `/markets/${id}/trades${qs ? `?${qs}` : ''}`,
    );
  },

  marketCandles: (id: string, opts: { bucket?: number; hours?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.bucket != null) params.set('bucket', String(opts.bucket));
    if (opts.hours != null) params.set('hours', String(opts.hours));
    const qs = params.toString();
    return request<CandleSeries>(`/markets/${id}/candles${qs ? `?${qs}` : ''}`);
  },

  // ─── Comments ───────────────────────────────────────────────────────────
  marketComments: (id: string) => request<Comment[]>(`/markets/${id}/comments`),

  postComment: (marketId: string, body: string) =>
    request<Comment>(`/markets/${marketId}/comments`, {
      method: 'POST',
      json: { body },
      auth: true,
    }),

  voteComment: (commentId: string, value: 1 | -1) =>
    request<{ score: number }>(`/comments/${commentId}/vote`, {
      method: 'POST',
      json: { value },
      auth: true,
    }),

  // ─── Leaderboard ────────────────────────────────────────────────────────
  leaderboard: () => request<LeaderboardResponse>('/leaderboard'),

  // ─── Bot stats ──────────────────────────────────────────────────────────
  botStats: () => request<BotsStatsResponse>('/bots/stats'),

  // ─── Orders ─────────────────────────────────────────────────────────────
  placeOrder: (body: PlaceOrderRequest) =>
    request<PlaceOrderResponse>('/orders', {
      method: 'POST',
      json: body,
      auth: true,
    }),

  cancelOrder: (orderId: string) =>
    request<{ order: Order }>(`/orders/${orderId}`, {
      method: 'DELETE',
      auth: true,
    }),

  // ─── Sports ─────────────────────────────────────────────────────────────
  sports: () => request<Array<{ id: SportId; name: string }>>('/sports'),
};
